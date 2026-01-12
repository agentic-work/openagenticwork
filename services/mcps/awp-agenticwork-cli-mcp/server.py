#!/usr/bin/env python3
"""
AWP AgenticWork CLI MCP Server - Controlled Agentic Workflows

This MCP server provides CONTROLLED execution capabilities for agentic workflows.
It is tightly managed by the code-manager service and emits structured events
for real-time UI visualization of agentic steps.

CAPABILITIES:
- execute_step: Execute a single step with progress tracking
- run_agentic_task: Run multi-step agentic workflows
- create_artifact: Create files/documents with step visualization
- execute_command: Run shell commands with output streaming
- present_artifact: Present completed artifacts to users

ARCHITECTURE:
  LLM -> MCP Proxy -> This MCP -> AgentiCode Manager -> PTY Session
                                       ↓
                              WebSocket Events -> UI (InlineToolBlock)

SECURITY:
- RBAC enforced via API access check (user must have agenticwork_cli permission)
- All execution happens in isolated user workspaces
- Code-manager controls session lifecycle
- Rate limiting and timeout enforcement
- Audit logging of all operations

EVENTS EMITTED (for UI visualization):
- step_start: When a step begins
- step_progress: Progress updates during execution
- step_complete: When a step completes
- artifact_created: When an artifact is created
- artifact_presented: When presenting to user
- task_complete: When entire task completes
"""

import os
import json
import logging
import time
import uuid
import httpx
from typing import Optional, Dict, Any, List
from enum import Enum

from fastmcp import FastMCP

# =============================================================================
# LOGGING
# =============================================================================

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("awp-agenticwork-cli-mcp")

# =============================================================================
# CONFIGURATION
# =============================================================================

MANAGER_URL = os.environ.get("AGENTICODE_MANAGER_URL", "http://agenticode-manager:3050")
API_URL = os.environ.get("AGENTICWORK_API_URL", "http://agenticwork-api:8000")
SERVICE_AUTH_KEY = os.environ.get("MCP_SERVICE_AUTH_KEY", "")

# Internal API key for code-manager authentication
INTERNAL_API_KEY = os.environ.get("INTERNAL_API_KEY", "")

# HTTP client with reasonable timeouts
http_client = httpx.Client(timeout=httpx.Timeout(180.0, connect=10.0))

# RBAC cache
_rbac_cache: Dict[str, tuple] = {}
RBAC_CACHE_TTL = 300

# =============================================================================
# TYPES
# =============================================================================

class StepStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    ERROR = "error"
    SKIPPED = "skipped"

class ArtifactType(str, Enum):
    FILE = "file"
    DOCUMENT = "document"
    CODE = "code"
    IMAGE = "image"
    DATA = "data"

# =============================================================================
# INITIALIZE MCP SERVER
# =============================================================================

mcp = FastMCP("agenticwork-cli-mcp")

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def check_user_access(user_id: str) -> bool:
    """
    Check if a user has access to AgenticWork CLI via RBAC.

    Requires the 'agenticwork_cli' permission, which is more permissive
    than the basic 'agenticode' permission.
    """
    import time

    if not user_id or user_id == "default":
        logger.warning(f"[RBAC] Invalid user_id: {user_id} - denying access")
        return False

    cache_key = f"cli_{user_id}"
    if cache_key in _rbac_cache:
        has_access, timestamp = _rbac_cache[cache_key]
        if time.time() - timestamp < RBAC_CACHE_TTL:
            return has_access

    try:
        headers = {
            "X-Service-Auth": SERVICE_AUTH_KEY,
            "X-Service-Name": "awp-agenticwork-cli-mcp"
        }

        response = http_client.get(
            f"{API_URL}/api/code/access-check",
            params={"userId": user_id, "capability": "agenticwork_cli"},
            headers=headers,
            timeout=httpx.Timeout(10.0, connect=5.0)
        )

        if response.status_code == 200:
            data = response.json()
            has_access = data.get("hasAccess", False)
            _rbac_cache[cache_key] = (has_access, time.time())
            return has_access
        elif response.status_code == 403:
            _rbac_cache[cache_key] = (False, time.time())
            return False
        else:
            return False

    except httpx.HTTPError as e:
        logger.error(f"[RBAC] Access check error for {user_id}: {e}")
        if cache_key in _rbac_cache:
            has_access, _ = _rbac_cache[cache_key]
            return has_access
        return False


def require_access(user_id: str) -> Optional[Dict[str, Any]]:
    """Check user access and return error dict if denied."""
    if not check_user_access(user_id):
        return {
            "success": False,
            "error": "Access denied. You do not have permission to use AgenticWork CLI.",
            "access_denied": True
        }
    return None


def get_manager_headers() -> Dict[str, str]:
    """Get headers for code-manager API calls."""
    headers = {}
    if INTERNAL_API_KEY:
        headers["Authorization"] = f"Bearer {INTERNAL_API_KEY}"
        headers["X-Internal-Api-Key"] = INTERNAL_API_KEY
    return headers


def emit_event(user_id: str, session_id: str, event_type: str, data: Dict[str, Any]) -> None:
    """
    Emit a structured event for UI visualization.

    Events are sent to the code-manager which broadcasts them to connected
    WebSocket clients for real-time display in InlineToolBlock.
    """
    try:
        event = {
            "type": event_type,
            "timestamp": int(time.time() * 1000),
            "sessionId": session_id,
            "userId": user_id,
            **data
        }

        # Post event to manager's event endpoint
        response = http_client.post(
            f"{MANAGER_URL}/events",
            json=event,
            headers=get_manager_headers(),
            timeout=httpx.Timeout(5.0, connect=2.0)
        )

        if response.status_code != 200:
            logger.warning(f"[Events] Failed to emit event: {response.status_code}")

    except Exception as e:
        logger.warning(f"[Events] Event emission failed: {e}")


def get_or_create_session(user_id: str) -> Dict[str, Any]:
    """Get existing session or create a new one for the user."""
    try:
        response = http_client.post(
            f"{MANAGER_URL}/sessions",
            json={"userId": user_id},
            headers=get_manager_headers()
        )
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as e:
        logger.error(f"Failed to get/create session: {e}")
        raise


def direct_write_file(user_id: str, filepath: str, content: str) -> Dict[str, Any]:
    """Write file directly to workspace."""
    try:
        response = http_client.post(
            f"{MANAGER_URL}/direct/write",
            json={"userId": user_id, "filepath": filepath, "content": content},
            headers=get_manager_headers(),
            timeout=httpx.Timeout(30.0, connect=10.0)
        )
        return response.json()
    except httpx.HTTPError as e:
        logger.error(f"Direct write failed: {e}")
        return {"success": False, "error": str(e)}


def direct_read_file(user_id: str, filepath: str) -> Dict[str, Any]:
    """Read file directly from workspace."""
    try:
        response = http_client.post(
            f"{MANAGER_URL}/direct/read",
            json={"userId": user_id, "filepath": filepath},
            headers=get_manager_headers(),
            timeout=httpx.Timeout(30.0, connect=10.0)
        )
        return response.json()
    except httpx.HTTPError as e:
        logger.error(f"Direct read failed: {e}")
        return {"success": False, "error": str(e), "content": ""}


def direct_exec_command(user_id: str, command: str, timeout: int = 60000) -> Dict[str, Any]:
    """Execute command directly in workspace with streaming events."""
    try:
        response = http_client.post(
            f"{MANAGER_URL}/direct/exec",
            json={"userId": user_id, "command": command, "timeout": timeout},
            headers=get_manager_headers(),
            timeout=httpx.Timeout(max(timeout / 1000 + 10, 180), connect=10.0)
        )
        return response.json()
    except httpx.HTTPError as e:
        logger.error(f"Direct exec failed: {e}")
        return {"success": False, "error": str(e), "stdout": "", "stderr": "", "exitCode": 1}


# =============================================================================
# TOOLS - CONTROLLED AGENTIC WORKFLOWS
# =============================================================================

@mcp.tool()
def execute_step(
    step_name: str,
    step_description: str,
    command: Optional[str] = None,
    code: Optional[str] = None,
    language: str = "bash",
    user_id: str = "default",
    timeout_seconds: int = 120
) -> Dict[str, Any]:
    """
    Execute a single step in an agentic workflow with progress tracking.

    This tool executes a command or code snippet and emits structured events
    for real-time UI visualization. Each step appears as an expandable item
    in the chat interface.

    Args:
        step_name: Short name for the step (e.g., "Creating document")
        step_description: Description of what this step does
        command: Shell command to execute (mutually exclusive with code)
        code: Code to execute (requires language parameter)
        language: Programming language for code execution (python, bash, javascript, etc.)
        user_id: User identifier for session isolation
        timeout_seconds: Maximum execution time

    Returns:
        Dict with:
        - success: bool
        - step_id: Unique identifier for this step
        - stdout: Standard output
        - stderr: Standard error
        - exitCode: Exit code
        - duration_ms: Execution time in milliseconds

    Example:
        execute_step(
            step_name="Installing dependencies",
            step_description="Installing required npm packages",
            command="npm install docx fs",
            user_id="user123"
        )
    """
    access_denied = require_access(user_id)
    if access_denied:
        return access_denied

    if not command and not code:
        return {"success": False, "error": "Either 'command' or 'code' is required"}

    step_id = str(uuid.uuid4())[:8]
    start_time = time.time()

    # Get or create session for event emission
    try:
        session_info = get_or_create_session(user_id)
        session_id = session_info.get("sessionId") or session_info.get("session", {}).get("id", "")
    except Exception:
        session_id = ""

    # Emit step start event
    emit_event(user_id, session_id, "step_start", {
        "stepId": step_id,
        "stepName": step_name,
        "stepDescription": step_description,
        "status": StepStatus.RUNNING.value
    })

    try:
        # Execute command or code
        if command:
            result = direct_exec_command(user_id, command, timeout_seconds * 1000)
        else:
            # Write code to temp file and execute
            import time as time_mod
            timestamp = int(time_mod.time())

            ext_map = {
                "python": ".py", "javascript": ".js", "typescript": ".ts",
                "bash": ".sh", "shell": ".sh", "go": ".go", "rust": ".rs"
            }
            run_map = {
                "python": "python3", "javascript": "node", "typescript": "npx ts-node",
                "bash": "bash", "shell": "sh", "go": "go run"
            }

            ext = ext_map.get(language.lower(), ".txt")
            runner = run_map.get(language.lower(), "bash")
            filename = f"step_{step_id}_{timestamp}{ext}"

            # Write code file
            write_result = direct_write_file(user_id, filename, code)
            if not write_result.get("success"):
                raise Exception(f"Failed to write code: {write_result.get('error')}")

            # Execute
            exec_cmd = f"{runner} {filename}"
            result = direct_exec_command(user_id, exec_cmd, timeout_seconds * 1000)

        duration_ms = int((time.time() - start_time) * 1000)
        success = result.get("success", False) and result.get("exitCode", 1) == 0

        # Emit step complete event
        emit_event(user_id, session_id, "step_complete", {
            "stepId": step_id,
            "stepName": step_name,
            "status": StepStatus.SUCCESS.value if success else StepStatus.ERROR.value,
            "durationMs": duration_ms,
            "exitCode": result.get("exitCode", 1)
        })

        logger.info(f"[AgenticWorkCLI] Step '{step_name}' completed for user {user_id} ({duration_ms}ms)")

        return {
            "success": success,
            "step_id": step_id,
            "step_name": step_name,
            "stdout": result.get("stdout", ""),
            "stderr": result.get("stderr", ""),
            "exitCode": result.get("exitCode", 1),
            "duration_ms": duration_ms
        }

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)

        emit_event(user_id, session_id, "step_complete", {
            "stepId": step_id,
            "stepName": step_name,
            "status": StepStatus.ERROR.value,
            "durationMs": duration_ms,
            "error": str(e)
        })

        logger.error(f"[AgenticWorkCLI] Step '{step_name}' failed: {e}")
        return {
            "success": False,
            "step_id": step_id,
            "error": str(e),
            "duration_ms": duration_ms
        }


@mcp.tool()
def create_artifact(
    artifact_name: str,
    artifact_type: str,
    filepath: str,
    content: str,
    description: str = "",
    user_id: str = "default"
) -> Dict[str, Any]:
    """
    Create an artifact (file, document, code, etc.) with UI visualization.

    This tool creates a file and emits events for the UI to show
    the creation process with expandable code/content preview.

    Args:
        artifact_name: Display name for the artifact
        artifact_type: Type of artifact (file, document, code, image, data)
        filepath: Path to save the artifact
        content: Content of the artifact
        description: Optional description of what was created
        user_id: User identifier

    Returns:
        Dict with:
        - success: bool
        - artifact_id: Unique identifier
        - filepath: Where the artifact was saved
        - size_bytes: Size of the created file

    Example:
        create_artifact(
            artifact_name="Word Document Generator",
            artifact_type="code",
            filepath="create-doc.js",
            content="const docx = require('docx');...",
            description="Script to generate Word document with checkboxes",
            user_id="user123"
        )
    """
    access_denied = require_access(user_id)
    if access_denied:
        return access_denied

    if not filepath or content is None:
        return {"success": False, "error": "filepath and content are required"}

    artifact_id = str(uuid.uuid4())[:8]
    start_time = time.time()

    # Get session for events
    try:
        session_info = get_or_create_session(user_id)
        session_id = session_info.get("sessionId") or session_info.get("session", {}).get("id", "")
    except Exception:
        session_id = ""

    # Emit artifact creation start
    emit_event(user_id, session_id, "artifact_start", {
        "artifactId": artifact_id,
        "artifactName": artifact_name,
        "artifactType": artifact_type,
        "filepath": filepath,
        "description": description
    })

    try:
        # Write the file
        result = direct_write_file(user_id, filepath, content)

        if not result.get("success"):
            raise Exception(result.get("error", "Failed to write file"))

        duration_ms = int((time.time() - start_time) * 1000)
        size_bytes = len(content.encode('utf-8'))

        # Emit artifact created event
        emit_event(user_id, session_id, "artifact_created", {
            "artifactId": artifact_id,
            "artifactName": artifact_name,
            "artifactType": artifact_type,
            "filepath": filepath,
            "sizeBytes": size_bytes,
            "durationMs": duration_ms
        })

        logger.info(f"[AgenticWorkCLI] Created artifact '{artifact_name}' at {filepath}")

        return {
            "success": True,
            "artifact_id": artifact_id,
            "artifact_name": artifact_name,
            "filepath": filepath,
            "size_bytes": size_bytes,
            "duration_ms": duration_ms
        }

    except Exception as e:
        emit_event(user_id, session_id, "artifact_error", {
            "artifactId": artifact_id,
            "artifactName": artifact_name,
            "error": str(e)
        })

        logger.error(f"[AgenticWorkCLI] Failed to create artifact: {e}")
        return {"success": False, "artifact_id": artifact_id, "error": str(e)}


@mcp.tool()
def execute_command(
    command: str,
    description: str = "",
    user_id: str = "default",
    working_directory: Optional[str] = None,
    timeout_seconds: int = 120,
    show_output: bool = True
) -> Dict[str, Any]:
    """
    Execute a shell command with output streaming and UI visualization.

    This tool runs a command and emits events for real-time output display
    in the chat interface. The command output appears inline with syntax
    highlighting.

    Args:
        command: Shell command to execute
        description: What this command does (shown in UI)
        user_id: User identifier
        working_directory: Optional directory to run command in
        timeout_seconds: Maximum execution time
        show_output: Whether to show output in UI (default True)

    Returns:
        Dict with:
        - success: bool
        - command_id: Unique identifier
        - stdout: Standard output
        - stderr: Standard error
        - exitCode: Exit code
        - duration_ms: Execution time

    Example:
        execute_command(
            command="npm install docx",
            description="Installing docx library for Word document generation",
            user_id="user123"
        )
    """
    access_denied = require_access(user_id)
    if access_denied:
        return access_denied

    if not command:
        return {"success": False, "error": "command is required"}

    command_id = str(uuid.uuid4())[:8]
    start_time = time.time()

    # Get session for events
    try:
        session_info = get_or_create_session(user_id)
        session_id = session_info.get("sessionId") or session_info.get("session", {}).get("id", "")
    except Exception:
        session_id = ""

    # Build full command with working directory
    full_command = command
    if working_directory:
        full_command = f"cd {working_directory} && {command}"

    # Emit command start event
    emit_event(user_id, session_id, "command_start", {
        "commandId": command_id,
        "command": command,
        "description": description,
        "workingDirectory": working_directory
    })

    try:
        result = direct_exec_command(user_id, full_command, timeout_seconds * 1000)

        duration_ms = int((time.time() - start_time) * 1000)
        success = result.get("success", False) and result.get("exitCode", 1) == 0

        # Emit command complete event
        emit_event(user_id, session_id, "command_complete", {
            "commandId": command_id,
            "exitCode": result.get("exitCode", 1),
            "durationMs": duration_ms,
            "stdout": result.get("stdout", "") if show_output else "[output hidden]",
            "stderr": result.get("stderr", "") if show_output else ""
        })

        logger.info(f"[AgenticWorkCLI] Command completed ({duration_ms}ms, exit={result.get('exitCode', 1)})")

        return {
            "success": success,
            "command_id": command_id,
            "stdout": result.get("stdout", ""),
            "stderr": result.get("stderr", ""),
            "exitCode": result.get("exitCode", 1),
            "duration_ms": duration_ms
        }

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)

        emit_event(user_id, session_id, "command_error", {
            "commandId": command_id,
            "error": str(e),
            "durationMs": duration_ms
        })

        logger.error(f"[AgenticWorkCLI] Command failed: {e}")
        return {"success": False, "command_id": command_id, "error": str(e), "duration_ms": duration_ms}


@mcp.tool()
def present_artifact(
    artifact_name: str,
    filepath: str,
    presentation_type: str = "download",
    message: str = "",
    user_id: str = "default"
) -> Dict[str, Any]:
    """
    Present a completed artifact to the user with UI visualization.

    This tool emits events to display the artifact in the chat interface
    with download links, preview, or inline display.

    Args:
        artifact_name: Display name for the artifact
        filepath: Path to the artifact file
        presentation_type: How to present (download, preview, inline)
        message: Optional message to show with the artifact
        user_id: User identifier

    Returns:
        Dict with:
        - success: bool
        - presentation_id: Unique identifier
        - download_url: URL to download the artifact (if applicable)

    Example:
        present_artifact(
            artifact_name="Generated Word Document",
            filepath="output/report.docx",
            presentation_type="download",
            message="Your Word document with checkboxes is ready!",
            user_id="user123"
        )
    """
    access_denied = require_access(user_id)
    if access_denied:
        return access_denied

    if not filepath:
        return {"success": False, "error": "filepath is required"}

    presentation_id = str(uuid.uuid4())[:8]

    # Get session for events
    try:
        session_info = get_or_create_session(user_id)
        session_id = session_info.get("sessionId") or session_info.get("session", {}).get("id", "")
    except Exception:
        session_id = ""

    # Check if file exists
    read_result = direct_read_file(user_id, filepath)
    if not read_result.get("success"):
        return {"success": False, "error": f"Artifact not found: {filepath}"}

    # Get file size
    content = read_result.get("content", "")
    size_bytes = len(content.encode('utf-8')) if isinstance(content, str) else len(content)

    # Emit presentation event
    emit_event(user_id, session_id, "artifact_presented", {
        "presentationId": presentation_id,
        "artifactName": artifact_name,
        "filepath": filepath,
        "presentationType": presentation_type,
        "message": message,
        "sizeBytes": size_bytes
    })

    logger.info(f"[AgenticWorkCLI] Presented artifact '{artifact_name}' to user {user_id}")

    return {
        "success": True,
        "presentation_id": presentation_id,
        "artifact_name": artifact_name,
        "filepath": filepath,
        "size_bytes": size_bytes,
        "message": message
    }


@mcp.tool()
def run_agentic_task(
    task_name: str,
    task_description: str,
    steps: List[Dict[str, Any]],
    user_id: str = "default"
) -> Dict[str, Any]:
    """
    Run a complete multi-step agentic task with progress tracking.

    This tool orchestrates multiple steps and provides comprehensive
    progress visualization in the UI. Each step is executed sequentially
    with real-time status updates.

    Args:
        task_name: Name of the overall task
        task_description: Description of what the task accomplishes
        steps: List of step definitions, each containing:
            - name: Step name
            - description: What this step does
            - command: Optional shell command
            - code: Optional code to execute
            - language: Language for code (if using code)
        user_id: User identifier

    Returns:
        Dict with:
        - success: bool (True if all steps succeeded)
        - task_id: Unique identifier
        - steps_completed: Number of steps that succeeded
        - steps_total: Total number of steps
        - results: List of results from each step
        - duration_ms: Total execution time

    Example:
        run_agentic_task(
            task_name="Generate Word Document",
            task_description="Create a Word document with checkboxes and links",
            steps=[
                {"name": "Install dependencies", "command": "npm install docx"},
                {"name": "Create generator", "code": "...", "language": "javascript"},
                {"name": "Generate document", "command": "node create-doc.js"}
            ],
            user_id="user123"
        )
    """
    access_denied = require_access(user_id)
    if access_denied:
        return access_denied

    if not steps or not isinstance(steps, list):
        return {"success": False, "error": "steps must be a non-empty list"}

    task_id = str(uuid.uuid4())[:8]
    start_time = time.time()
    results = []
    steps_completed = 0

    # Get session for events
    try:
        session_info = get_or_create_session(user_id)
        session_id = session_info.get("sessionId") or session_info.get("session", {}).get("id", "")
    except Exception:
        session_id = ""

    # Emit task start event
    emit_event(user_id, session_id, "task_start", {
        "taskId": task_id,
        "taskName": task_name,
        "taskDescription": task_description,
        "stepsTotal": len(steps)
    })

    logger.info(f"[AgenticWorkCLI] Starting task '{task_name}' with {len(steps)} steps")

    # Execute each step
    all_success = True
    for i, step in enumerate(steps):
        step_name = step.get("name", f"Step {i + 1}")
        step_description = step.get("description", "")
        command = step.get("command")
        code = step.get("code")
        language = step.get("language", "bash")

        # Emit step progress
        emit_event(user_id, session_id, "task_progress", {
            "taskId": task_id,
            "currentStep": i + 1,
            "stepsTotal": len(steps),
            "stepName": step_name
        })

        # Execute the step
        result = execute_step(
            step_name=step_name,
            step_description=step_description,
            command=command,
            code=code,
            language=language,
            user_id=user_id,
            timeout_seconds=120
        )

        results.append(result)

        if result.get("success"):
            steps_completed += 1
        else:
            all_success = False
            # Stop on first failure
            logger.warning(f"[AgenticWorkCLI] Task '{task_name}' failed at step {i + 1}: {step_name}")
            break

    duration_ms = int((time.time() - start_time) * 1000)

    # Emit task complete event
    emit_event(user_id, session_id, "task_complete", {
        "taskId": task_id,
        "taskName": task_name,
        "success": all_success,
        "stepsCompleted": steps_completed,
        "stepsTotal": len(steps),
        "durationMs": duration_ms
    })

    logger.info(f"[AgenticWorkCLI] Task '{task_name}' completed: {steps_completed}/{len(steps)} steps ({duration_ms}ms)")

    return {
        "success": all_success,
        "task_id": task_id,
        "task_name": task_name,
        "steps_completed": steps_completed,
        "steps_total": len(steps),
        "results": results,
        "duration_ms": duration_ms
    }


@mcp.tool()
def read_workspace_file(
    filepath: str,
    user_id: str = "default"
) -> Dict[str, Any]:
    """
    Read a file from the user's workspace.

    This is a utility tool for reading files during agentic workflows.

    Args:
        filepath: Path to the file to read
        user_id: User identifier

    Returns:
        Dict with:
        - success: bool
        - content: File contents
        - error: Error message if failed
    """
    access_denied = require_access(user_id)
    if access_denied:
        return {**access_denied, "content": ""}

    if not filepath:
        return {"success": False, "error": "filepath is required", "content": ""}

    return direct_read_file(user_id, filepath)


@mcp.tool()
def list_workspace_files(
    directory: str = ".",
    user_id: str = "default",
    recursive: bool = False
) -> Dict[str, Any]:
    """
    List files in the user's workspace.

    This is a utility tool for exploring the workspace during agentic workflows.

    Args:
        directory: Directory to list (default: workspace root)
        user_id: User identifier
        recursive: Whether to list recursively

    Returns:
        Dict with:
        - success: bool
        - files: List of files
        - error: Error message if failed
    """
    access_denied = require_access(user_id)
    if access_denied:
        return {**access_denied, "files": []}

    try:
        response = http_client.post(
            f"{MANAGER_URL}/direct/list",
            json={"userId": user_id, "directory": directory, "recursive": recursive},
            headers=get_manager_headers(),
            timeout=httpx.Timeout(30.0, connect=10.0)
        )
        return response.json()
    except httpx.HTTPError as e:
        logger.error(f"List files failed: {e}")
        return {"success": False, "error": str(e), "files": []}


# =============================================================================
# SERVERLESS AGENTICODE-CLI EXECUTION
# One-shot CLI calls for chat mode users
# =============================================================================

@mcp.tool()
def run_agenticode_task(
    prompt: str,
    user_id: str = "default",
    api_key: Optional[str] = None,
    api_endpoint: str = "https://chat-dev.agenticwork.io",
    yolo: bool = True,
    timeout_seconds: int = 120,
    working_directory: Optional[str] = None
) -> Dict[str, Any]:
    """
    Execute an agentic task using the AgentiCode CLI in serverless mode.

    This tool runs agenticode-cli as a one-shot command, perfect for chat mode
    users who want agentic capabilities without maintaining a persistent session.

    The CLI will use the platform's LLM providers (via --provider api) and can
    execute complex multi-step tasks like:
    - Creating and editing files
    - Running shell commands
    - Writing and executing code
    - Refactoring projects

    Args:
        prompt: The task/prompt to send to AgentiCode CLI
        user_id: User identifier for workspace isolation
        api_key: User's API key for authentication (required)
        api_endpoint: API endpoint URL (default: https://chat-dev.agenticwork.io)
        yolo: Auto-approve tool executions (default: True)
        timeout_seconds: Maximum execution time (default: 120)
        working_directory: Optional subdirectory within workspace

    Returns:
        Dict with:
        - success: bool
        - output: CLI output
        - stderr: Error output if any
        - exitCode: Exit code
        - duration: Execution time in ms

    Example:
        run_agenticode_task(
            prompt="Create a Python script that reads a CSV file and generates a summary report",
            user_id="user123",
            api_key="awc_xxx",
            yolo=True
        )
    """
    access_denied = require_access(user_id)
    if access_denied:
        return access_denied

    if not prompt:
        return {"success": False, "error": "prompt is required"}

    if not api_key:
        return {"success": False, "error": "api_key is required for serverless execution"}

    try:
        response = http_client.post(
            f"{MANAGER_URL}/serverless/exec",
            json={
                "userId": user_id,
                "prompt": prompt,
                "apiKey": api_key,
                "apiEndpoint": api_endpoint,
                "yolo": yolo,
                "timeout": timeout_seconds * 1000,
                "workingDirectory": working_directory
            },
            headers=get_manager_headers(),
            timeout=httpx.Timeout(timeout_seconds + 30, connect=10.0)
        )
        result = response.json()

        logger.info(f"[AgenticWorkCLI] Serverless task completed for user {user_id}")
        return result

    except httpx.HTTPError as e:
        logger.error(f"Serverless execution failed: {e}")
        return {"success": False, "error": str(e)}


@mcp.tool()
def check_agenticode_status(user_id: str = "default") -> Dict[str, Any]:
    """
    Check if serverless AgentiCode CLI execution is available.

    Returns information about the CLI availability and supported features.

    Args:
        user_id: User identifier

    Returns:
        Dict with:
        - available: bool
        - cliVersion: CLI version string
        - supportedProviders: List of supported LLM providers
        - features: Supported features (streaming, yolo, etc.)
    """
    access_denied = require_access(user_id)
    if access_denied:
        return access_denied

    try:
        response = http_client.get(
            f"{MANAGER_URL}/serverless/status",
            headers=get_manager_headers(),
            timeout=httpx.Timeout(10.0, connect=5.0)
        )
        return response.json()

    except httpx.HTTPError as e:
        logger.error(f"Status check failed: {e}")
        return {"available": False, "error": str(e)}


@mcp.tool()
def run_code_generation(
    description: str,
    language: str = "python",
    filename: Optional[str] = None,
    user_id: str = "default",
    api_key: Optional[str] = None,
    execute_after: bool = False
) -> Dict[str, Any]:
    """
    Generate and optionally execute code using AgentiCode CLI.

    This is a convenience tool that wraps run_agenticode_task with a
    code-generation-focused prompt.

    Args:
        description: What the code should do
        language: Programming language (python, javascript, typescript, bash, go, rust)
        filename: Optional filename to save the code to
        user_id: User identifier
        api_key: User's API key (required)
        execute_after: Whether to execute the code after generation

    Returns:
        Dict with:
        - success: bool
        - output: Generated code or execution output
        - filename: Where the code was saved
        - error: Error message if failed

    Example:
        run_code_generation(
            description="A function to calculate Fibonacci numbers",
            language="python",
            filename="fibonacci.py",
            user_id="user123",
            api_key="awc_xxx",
            execute_after=True
        )
    """
    access_denied = require_access(user_id)
    if access_denied:
        return access_denied

    if not description:
        return {"success": False, "error": "description is required"}

    if not api_key:
        return {"success": False, "error": "api_key is required"}

    # Build a focused code generation prompt
    target_file = filename or f"generated_code.{_get_extension(language)}"
    prompt = f"Write {language} code that {description}. Save it to {target_file}."

    if execute_after:
        prompt += f" Then execute it and show the output."

    return run_agenticode_task(
        prompt=prompt,
        user_id=user_id,
        api_key=api_key,
        yolo=True,
        timeout_seconds=180
    )


def _get_extension(language: str) -> str:
    """Get file extension for a language."""
    extensions = {
        "python": "py",
        "javascript": "js",
        "typescript": "ts",
        "bash": "sh",
        "shell": "sh",
        "go": "go",
        "rust": "rs",
        "ruby": "rb",
        "java": "java",
        "c": "c",
        "cpp": "cpp",
    }
    return extensions.get(language.lower(), "txt")


@mcp.tool()
def run_file_operation(
    operation: str,
    filepath: str,
    content: Optional[str] = None,
    user_id: str = "default",
    api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Perform intelligent file operations using AgentiCode CLI.

    This tool leverages the CLI's file manipulation capabilities for
    operations that benefit from AI understanding, like:
    - Refactoring code
    - Adding documentation
    - Fixing bugs
    - Translating between languages

    Args:
        operation: What to do (e.g., "refactor", "add docstrings", "fix bugs", "translate to typescript")
        filepath: Path to the file to operate on
        content: Optional new content (for create/write operations)
        user_id: User identifier
        api_key: User's API key (required)

    Returns:
        Dict with operation result

    Example:
        run_file_operation(
            operation="add comprehensive docstrings and type hints",
            filepath="utils.py",
            user_id="user123",
            api_key="awc_xxx"
        )
    """
    access_denied = require_access(user_id)
    if access_denied:
        return access_denied

    if not operation:
        return {"success": False, "error": "operation is required"}

    if not filepath:
        return {"success": False, "error": "filepath is required"}

    if not api_key:
        return {"success": False, "error": "api_key is required"}

    # Build the prompt
    if content:
        prompt = f"Create or update the file {filepath} with this operation: {operation}. Use this content as a starting point: {content[:500]}..."
    else:
        prompt = f"Read the file {filepath} and {operation}. Save the changes back to the file."

    return run_agenticode_task(
        prompt=prompt,
        user_id=user_id,
        api_key=api_key,
        yolo=True,
        timeout_seconds=120
    )


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    logger.info("[AgenticWorkCLI] Starting AWP AgenticWork CLI MCP Server...")
    logger.info("[AgenticWorkCLI] Controlled agentic workflows enabled")
    logger.info(f"[AgenticWorkCLI] Manager URL: {MANAGER_URL}")
    mcp.run()
