/**
 * Model Store
 * Centralized state management for LLM model selection
 * Handles model selection, available models list, and multi-model mode
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  provider?: string;
  capabilities?: string[];
}

interface ModelState {
  // Selected model (empty string = let router decide)
  selectedModel: string;

  // List of available models
  availableModels: ModelInfo[];

  // Multi-model orchestration mode
  isMultiModelEnabled: boolean;

  // Loading state
  isLoadingModels: boolean;
}

interface ModelActions {
  // Set selected model
  setSelectedModel: (modelId: string) => void;

  // Set available models
  setAvailableModels: (models: ModelInfo[]) => void;

  // Toggle multi-model mode
  toggleMultiModel: () => void;
  setMultiModelEnabled: (enabled: boolean) => void;

  // Set loading state
  setLoadingModels: (loading: boolean) => void;

  // Reset to default (router selection)
  resetToDefault: () => void;

  // Initialize model from localStorage (for admin users)
  initializeModel: (isAdmin: boolean, availableModelIds: string[]) => void;
}

type ModelStore = ModelState & ModelActions;

const initialState: ModelState = {
  selectedModel: '', // Empty = router decides
  availableModels: [],
  isMultiModelEnabled: false,
  isLoadingModels: false,
};

export const useModelStore = create<ModelStore>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        setSelectedModel: (modelId) => {
          set(
            { selectedModel: modelId },
            false,
            'setSelectedModel'
          );
        },

        setAvailableModels: (models) => {
          set(
            { availableModels: models },
            false,
            'setAvailableModels'
          );
        },

        toggleMultiModel: () => {
          set(
            (state) => ({ isMultiModelEnabled: !state.isMultiModelEnabled }),
            false,
            'toggleMultiModel'
          );
        },

        setMultiModelEnabled: (enabled) => {
          set(
            { isMultiModelEnabled: enabled },
            false,
            'setMultiModelEnabled'
          );
        },

        setLoadingModels: (loading) => {
          set(
            { isLoadingModels: loading },
            false,
            'setLoadingModels'
          );
        },

        resetToDefault: () => {
          set(
            { selectedModel: '' },
            false,
            'resetToDefault'
          );
        },

        initializeModel: (isAdmin, availableModelIds) => {
          const { selectedModel } = get();

          if (isAdmin) {
            // For admins, validate stored model against available models
            if (selectedModel && availableModelIds.includes(selectedModel)) {
              // Stored model is valid - keep it
              console.log('[ModelStore] Admin using stored model:', selectedModel);
            } else {
              // No valid stored model - use default (router selection)
              console.log('[ModelStore] Admin no valid stored model, using default');
              set({ selectedModel: '' }, false, 'initializeModel/resetToDefault');
            }
          } else {
            // Non-admin - always use default
            console.log('[ModelStore] Non-admin, using default model-router');
            set({ selectedModel: '' }, false, 'initializeModel/nonAdmin');
          }
        },
      }),
      {
        name: 'model-selection',
        // Only persist selectedModel for admin use
        partialize: (state) => ({
          selectedModel: state.selectedModel,
        }),
      }
    ),
    { name: 'ModelStore' }
  )
);

// Selector hooks - use shallow for arrays and objects to prevent re-renders
export const useSelectedModel = () =>
  useModelStore((state) => state.selectedModel);

export const useAvailableModels = () =>
  useModelStore((state) => state.availableModels, shallow);

export const useIsMultiModelEnabled = () =>
  useModelStore((state) => state.isMultiModelEnabled);

export const useIsLoadingModels = () =>
  useModelStore((state) => state.isLoadingModels);

// Action hooks - use shallow for object return
export const useModelActions = () =>
  useModelStore(
    (state) => ({
      setSelectedModel: state.setSelectedModel,
      setAvailableModels: state.setAvailableModels,
      toggleMultiModel: state.toggleMultiModel,
      setMultiModelEnabled: state.setMultiModelEnabled,
      resetToDefault: state.resetToDefault,
      initializeModel: state.initializeModel,
    }),
    shallow
  );
