/**
 * VectorCollections Component
 *
 * Shows Milvus vector collections for the user's workspace.
 * Allows viewing, searching, and managing vector embeddings.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Database,
  Search,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  FileText,
  Hash,
  Layers,
  Trash2,
  Plus,
  Loader2,
  AlertCircle,
} from '@/shared/icons';

interface Collection {
  name: string;
  description?: string;
  numEntities: number;
  dimension: number;
  createdAt?: string;
}

interface VectorCollectionsProps {
  userId: string;
  theme: 'light' | 'dark';
  className?: string;
}

export const VectorCollections: React.FC<VectorCollectionsProps> = ({
  userId,
  theme,
  className = '',
}) => {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch collections from CodeMode Milvus API
  const fetchCollections = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const authToken = localStorage.getItem('auth_token');

      // Fetch from direct CodeMode collections API
      const response = await fetch('/api/code/collections', {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch vector collections');
      }

      const data = await response.json();

      if (data.collections && Array.isArray(data.collections)) {
        setCollections(data.collections.map((c: any) => ({
          name: c.name || c.id,
          description: c.description || `CodeMode collection: ${c.numEntities || 0} vectors`,
          numEntities: c.numEntities || 0,
          dimension: c.dimension || 1536,
          createdAt: c.createdAt,
        })));
      } else {
        setCollections([]);
      }
    } catch (err: any) {
      console.error('[VectorCollections] Error:', err);
      setError(err.message || 'Failed to load collections');
      setCollections([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchCollections();
  }, [fetchCollections]);

  // Toggle collection expansion
  const toggleCollection = useCallback((name: string) => {
    setExpandedCollections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(name)) {
        newSet.delete(name);
      } else {
        newSet.add(name);
      }
      return newSet;
    });
  }, []);

  // Filter collections by search
  const filteredCollections = collections.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <Database size={14} className="text-[var(--color-primary)]" />
          <span className="text-xs font-medium text-[var(--color-text)]">
            Vector Collections
          </span>
        </div>
        <button
          onClick={fetchCollections}
          className="p-1 rounded hover:bg-[var(--color-surfaceHover)]"
          title="Refresh collections"
        >
          <RefreshCw size={12} className={`text-[var(--color-textMuted)] ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Search */}
      <div className="p-2">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-[var(--color-background)] border border-[var(--color-border)]">
          <Search size={14} className="text-[var(--color-textMuted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search collections..."
            className="flex-1 text-xs bg-transparent outline-none text-[var(--color-text)] placeholder-[var(--color-textMuted)]"
          />
        </div>
      </div>

      {/* Collections List */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-[var(--color-textMuted)]" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center py-8 px-4 text-center">
            <AlertCircle size={24} className="text-[var(--color-error)]" />
            <p className="text-xs mt-2 text-[var(--color-error)]">
              {error}
            </p>
            <button
              onClick={fetchCollections}
              className="mt-3 px-3 py-1 text-xs rounded bg-[var(--color-surfaceSecondary)] text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
            >
              Retry
            </button>
          </div>
        ) : filteredCollections.length === 0 ? (
          <div className="flex flex-col items-center py-8 px-4 text-center">
            <Database size={32} className="text-[var(--color-border)]" />
            <p className="text-sm mt-2 text-[var(--color-textMuted)]">
              {searchQuery ? 'No matching collections' : 'No vector collections'}
            </p>
            <p className="text-xs mt-1 text-[var(--color-textMuted)]">
              {searchQuery ? 'Try a different search' : 'Collections will appear when created'}
            </p>
          </div>
        ) : (
          <div className="py-1">
            {filteredCollections.map((collection) => (
              <div key={collection.name}>
                <div
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[var(--color-surfaceHover)]"
                  onClick={() => toggleCollection(collection.name)}
                >
                  {expandedCollections.has(collection.name) ? (
                    <ChevronDown size={14} className="text-[var(--color-textMuted)]" />
                  ) : (
                    <ChevronRight size={14} className="text-[var(--color-textMuted)]" />
                  )}
                  <Layers size={14} className="text-[var(--color-primary)]" />
                  <span className="flex-1 text-sm truncate text-[var(--color-text)]">
                    {collection.name}
                  </span>
                  <span className="text-xs text-[var(--color-textMuted)]">
                    {collection.numEntities.toLocaleString()}
                  </span>
                </div>

                {/* Collection Details */}
                <AnimatePresence>
                  {expandedCollections.has(collection.name) && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden ml-6 mr-2 mb-2 p-2 rounded bg-[var(--color-background)]"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Hash size={12} className="text-[var(--color-textMuted)]" />
                          <span className="text-xs text-[var(--color-textSecondary)]">
                            Dimension: {collection.dimension}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <FileText size={12} className="text-[var(--color-textMuted)]" />
                          <span className="text-xs text-[var(--color-textSecondary)]">
                            Entities: {collection.numEntities.toLocaleString()}
                          </span>
                        </div>
                        {collection.description && (
                          <p className="text-xs text-[var(--color-textMuted)] mt-1">
                            {collection.description}
                          </p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-[var(--color-border)]">
        <span className="text-xs text-[var(--color-textMuted)]">
          {collections.length} collection{collections.length !== 1 ? 's' : ''}
        </span>
        <button
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-[var(--color-success)] hover:opacity-90 text-white"
          title="Create new collection"
        >
          <Plus size={12} />
          New
        </button>
      </div>
    </div>
  );
};

export default VectorCollections;
