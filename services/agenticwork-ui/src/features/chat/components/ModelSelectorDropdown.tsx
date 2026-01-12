/**
 * ModelSelectorDropdown - Standalone model selector dropdown component
 * Extracted from ChatInputToolbar for reusability
 * Features:
 * - Fixed positioning with React Portal
 * - Glassmorphic styling
 * - Keyboard navigation support
 * - Default model option
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check, Sparkles } from '@/shared/icons';
import clsx from 'clsx';

export interface ModelOption {
  id: string;
  name: string;
  description?: string;
  type?: string;
  provider?: string;
}

export interface ModelSelectorDropdownProps {
  selectedModel: string;
  availableModels: ModelOption[];
  onModelChange: (model: string) => void;
  onClose: () => void;
  buttonRef: React.RefObject<HTMLButtonElement>;
  position?: 'above' | 'below';
}

export const ModelSelectorDropdown: React.FC<ModelSelectorDropdownProps> = ({
  selectedModel,
  availableModels,
  onModelChange,
  onClose,
  buttonRef,
  position = 'above'
}) => {
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  // Filter chat models
  const chatModels = availableModels.filter(m => m.type === 'chat');

  // Calculate position based on button
  useEffect(() => {
    const updatePosition = () => {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        const dropdownHeight = 270; // Approximate dropdown height

        if (position === 'above') {
          setDropdownPosition({
            top: rect.top - dropdownHeight - 8,
            left: rect.left
          });
        } else {
          setDropdownPosition({
            top: rect.bottom + 8,
            left: rect.left
          });
        }
      }
    };

    updatePosition();
    window.addEventListener('scroll', updatePosition);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition);
      window.removeEventListener('resize', updatePosition);
    };
  }, [buttonRef, position]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const totalItems = chatModels.length + 1; // +1 for default option

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex(prev => (prev + 1) % totalItems);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex(prev => (prev - 1 + totalItems) % totalItems);
        break;
      case 'Enter':
        e.preventDefault();
        if (focusedIndex === 0) {
          onModelChange('');
          onClose();
        } else if (focusedIndex > 0 && focusedIndex <= chatModels.length) {
          onModelChange(chatModels[focusedIndex - 1].id);
          onClose();
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  }, [chatModels, focusedIndex, onModelChange, onClose]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
          onClose();
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [buttonRef, onClose]);

  return createPortal(
    <div
      ref={dropdownRef}
      className="model-selector-dropdown min-w-[250px] max-h-[260px] rounded-xl"
      style={{
        position: 'fixed',
        top: `${dropdownPosition.top}px`,
        left: `${dropdownPosition.left}px`,
        zIndex: 10000,
        backdropFilter: 'blur(16px) saturate(180%)',
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--color-shadow)',
        color: 'var(--color-text)'
      }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="p-2 max-h-60 overflow-y-auto">
        {/* Default/Auto option */}
        <button
          onClick={() => {
            onModelChange('');
            onClose();
          }}
          className={clsx(
            'w-full text-left px-3 py-2 rounded-md transition-colors text-sm flex items-center justify-between',
            focusedIndex === 0 && 'ring-2 ring-blue-500/50'
          )}
          style={{
            color: 'var(--color-text)',
            backgroundColor: !selectedModel ? 'color-mix(in srgb, var(--color-primary) 30%, transparent)' : 'transparent'
          }}
          onMouseEnter={(e) => {
            setFocusedIndex(0);
            if (selectedModel) {
              e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = !selectedModel ? 'color-mix(in srgb, var(--color-primary) 30%, transparent)' : 'transparent';
          }}
          aria-selected={!selectedModel}
          role="option"
        >
          <div>
            <div className="font-medium flex items-center gap-2">
              <Sparkles size={14} className="text-blue-400" />
              Default Model
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--color-textMuted)' }}>
              Use the system default model
            </div>
          </div>
          {!selectedModel && <Check size={16} className="text-blue-400" />}
        </button>

        {/* Model options */}
        {chatModels.map((model, index) => (
          <button
            key={model.id}
            onClick={() => {
              onModelChange(model.id);
              onClose();
            }}
            className={clsx(
              'w-full text-left px-3 py-2 rounded-md transition-colors text-sm flex items-center justify-between',
              focusedIndex === index + 1 && 'ring-2 ring-blue-500/50'
            )}
            style={{
              color: 'var(--color-text)',
              backgroundColor: selectedModel === model.id ? 'color-mix(in srgb, var(--color-primary) 30%, transparent)' : 'transparent'
            }}
            onMouseEnter={(e) => {
              setFocusedIndex(index + 1);
              if (selectedModel !== model.id) {
                e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = selectedModel === model.id ? 'color-mix(in srgb, var(--color-primary) 30%, transparent)' : 'transparent';
            }}
            aria-selected={selectedModel === model.id}
            role="option"
          >
            <div>
              <div className="font-medium">{model.name}</div>
              {model.description && (
                <div className="text-xs mt-1" style={{ color: 'var(--color-textMuted)' }}>
                  {model.description}
                </div>
              )}
            </div>
            {selectedModel === model.id && <Check size={16} className="text-blue-400" />}
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
};

// Compact trigger button for model selection
export const ModelSelectorButton: React.FC<{
  selectedModel: string;
  modelName?: string;
  onClick: () => void;
  isOpen?: boolean;
  disabled?: boolean;
  className?: string;
}> = ({
  selectedModel,
  modelName,
  onClick,
  isOpen = false,
  disabled = false,
  className = ''
}) => {
  const displayName = selectedModel ? (modelName || selectedModel) : 'Default';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'model-selector-button flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all',
        'hover:bg-white/10',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
      style={{
        color: 'var(--color-textMuted)',
        backgroundColor: isOpen ? 'var(--color-surfaceHover)' : 'transparent'
      }}
      aria-haspopup="listbox"
      aria-expanded={isOpen}
    >
      <span className="truncate max-w-[120px]">{displayName}</span>
      <ChevronDown
        size={14}
        className={clsx(
          'transition-transform duration-200',
          isOpen && 'rotate-180'
        )}
      />
    </button>
  );
};

export default ModelSelectorDropdown;
