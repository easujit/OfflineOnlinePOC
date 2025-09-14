// Enhanced IndexedDB helper for persistent storage
const DB_NAME = 'offon_notes';
const DB_VERSION = 2; // Incremented for new schema

export function withDB(name = DB_NAME, version = DB_VERSION) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const transaction = e.target.transaction;
      
      console.log('IndexedDB upgrade needed, version:', e.oldVersion, '->', e.newVersion);
      
      // Create or upgrade notes store
      if (!db.objectStoreNames.contains('notes')) {
        const notesStore = db.createObjectStore('notes', { 
          keyPath: 'id',
          autoIncrement: false 
        });
        
        // Create indexes for better querying
        notesStore.createIndex('updated_at', 'updated_at', { unique: false });
        notesStore.createIndex('status', 'status', { unique: false });
        notesStore.createIndex('version', 'version', { unique: false });
        notesStore.createIndex('title', 'title', { unique: false });
        
        console.log('Created notes store with indexes');
      } else {
        // Upgrade existing notes store if needed
        const notesStore = transaction.objectStore('notes');
        
        // Add new indexes if they don't exist
        if (!notesStore.indexNames.contains('status')) {
          notesStore.createIndex('status', 'status', { unique: false });
        }
        if (!notesStore.indexNames.contains('version')) {
          notesStore.createIndex('version', 'version', { unique: false });
        }
        if (!notesStore.indexNames.contains('title')) {
          notesStore.createIndex('title', 'title', { unique: false });
        }
      }
      
      // Create or upgrade outbox store
      if (!db.objectStoreNames.contains('outbox')) {
        const outboxStore = db.createObjectStore('outbox', { 
          keyPath: 'uuid',
          autoIncrement: false 
        });
        
        // Create indexes for outbox management
        outboxStore.createIndex('timestamp', 'ts', { unique: false });
        outboxStore.createIndex('entity_type', 'entity_type', { unique: false });
        outboxStore.createIndex('retries', 'retries', { unique: false });
        
        console.log('Created outbox store with indexes');
      }
      
      // Create or upgrade meta store
      if (!db.objectStoreNames.contains('meta')) {
        const metaStore = db.createObjectStore('meta', { 
          keyPath: 'key',
          autoIncrement: false 
        });
        
        console.log('Created meta store');
      }
      
      // Create or upgrade sync store for better sync management
      if (!db.objectStoreNames.contains('sync')) {
        const syncStore = db.createObjectStore('sync', { 
          keyPath: 'id',
          autoIncrement: true 
        });
        
        syncStore.createIndex('timestamp', 'timestamp', { unique: false });
        syncStore.createIndex('type', 'type', { unique: false });
        
        console.log('Created sync store for sync history');
      }
    };
    
    req.onsuccess = () => {
      const db = req.result;
      
      // Add connection management
      db.onversionchange = () => {
        console.log('Database version changed, closing connection');
        db.close();
      };
      
      db.onerror = (event) => {
        console.error('Database error:', event);
      };
      
      console.log('IndexedDB connection established:', db.name, 'v' + db.version);
      resolve(db);
    };
    
    req.onerror = (event) => {
      console.error('Failed to open IndexedDB:', event);
      reject(new Error(`Failed to open database: ${event.target.error?.message || 'Unknown error'}`));
    };
    
    req.onblocked = () => {
      console.warn('Database upgrade blocked by another connection');
    };
  });
}

export async function tx(db, storeNames, mode = 'readonly') {
  if (!db) {
    throw new Error('Database connection is null');
  }
  
  if (db.readyState !== 'open') {
    console.warn('Database connection is not open, attempting to reconnect...');
    // Try to reconnect
    const newDb = await withDB();
    return newDb.transaction(storeNames, mode);
  }
  
  return db.transaction(storeNames, mode);
}

// Enhanced storage operations with better error handling
export class PersistentStorage {
  constructor(dbName = DB_NAME, dbVersion = DB_VERSION) {
    this.dbName = dbName;
    this.dbVersion = dbVersion;
    this.db = null;
  }
  
  async connect() {
    if (this.db && this.db.readyState === 'open') {
      return this.db;
    }
    
    // Close existing connection if it exists but is not open
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    
    this.db = await withDB(this.dbName, this.dbVersion);
    return this.db;
  }
  
  async disconnect() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
  
  async ensureConnection(retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        await this.connect();
        return;
      } catch (error) {
        console.warn(`Database connection attempt ${i + 1} failed:`, error);
        if (i === retries - 1) {
          console.error('All database connection attempts failed');
          throw new Error(`Database connection failed after ${retries} attempts: ${error.message}`);
        }
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 100 * (i + 1)));
      }
    }
  }
  
  async getNotes(filters = {}) {
    await this.ensureConnection();
    const db = await this.connect();
    const transaction = await tx(db, ['notes'], 'readonly');
    const store = transaction.objectStore('notes');
    
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        let notes = request.result;
        
        // Apply filters
        if (filters.status) {
          notes = notes.filter(note => note.status === filters.status);
        }
        if (filters.search) {
          const searchTerm = filters.search.toLowerCase();
          notes = notes.filter(note => 
            note.title.toLowerCase().includes(searchTerm) ||
            note.content.toLowerCase().includes(searchTerm)
          );
        }
        if (filters.limit) {
          notes = notes.slice(0, filters.limit);
        }
        
        // Sort by updated_at descending
        notes.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
        
        resolve(notes);
      };
      request.onerror = () => reject(request.error);
    });
  }
  
  async saveNote(note) {
    await this.ensureConnection();
    const db = await this.connect();
    const transaction = await tx(db, ['notes'], 'readwrite');
    const store = transaction.objectStore('notes');
    
    return new Promise((resolve, reject) => {
      const request = store.put(note);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  
  async deleteNote(noteId) {
    await this.ensureConnection();
    const db = await this.connect();
    const transaction = await tx(db, ['notes'], 'readwrite');
    const store = transaction.objectStore('notes');
    
    return new Promise((resolve, reject) => {
      const request = store.delete(noteId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  
  async getOutbox() {
    await this.ensureConnection();
    const db = await this.connect();
    const transaction = await tx(db, ['outbox'], 'readonly');
    const store = transaction.objectStore('outbox');
    
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  
  async addToOutbox(job) {
    await this.ensureConnection();
    const db = await this.connect();
    const transaction = await tx(db, ['outbox'], 'readwrite');
    const store = transaction.objectStore('outbox');
    
    return new Promise((resolve, reject) => {
      const request = store.put(job);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  
  async removeFromOutbox(uuid) {
    await this.ensureConnection();
    const db = await this.connect();
    const transaction = await tx(db, ['outbox'], 'readwrite');
    const store = transaction.objectStore('outbox');
    
    return new Promise((resolve, reject) => {
      const request = store.delete(uuid);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  
  async getMeta(key) {
    await this.ensureConnection();
    const db = await this.connect();
    const transaction = await tx(db, ['meta'], 'readonly');
    const store = transaction.objectStore('meta');
    
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result?.value || null);
      request.onerror = () => reject(request.error);
    });
  }
  
  async setMeta(key, value) {
    await this.ensureConnection();
    const db = await this.connect();
    const transaction = await tx(db, ['meta'], 'readwrite');
    const store = transaction.objectStore('meta');
    
    return new Promise((resolve, reject) => {
      const request = store.put({ key, value });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  
  async clearAll() {
    await this.ensureConnection();
    const db = await this.connect();
    const transaction = await tx(db, ['notes', 'outbox', 'meta', 'sync'], 'readwrite');
    
    const clearStore = (storeName) => {
      return new Promise((resolve, reject) => {
        const store = transaction.objectStore(storeName);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    };
    
    try {
      await clearStore('notes');
      await clearStore('outbox');
      await clearStore('meta');
      await clearStore('sync');
      console.log('All data cleared from IndexedDB');
    } catch (error) {
      console.error('Error clearing data:', error);
      throw error;
    }
  }
  
  async getStorageInfo() {
    await this.ensureConnection();
    const db = await this.connect();
    const transaction = await tx(db, ['notes', 'outbox', 'meta', 'sync'], 'readonly');
    
    const getCount = (storeName) => {
      return new Promise((resolve, reject) => {
        const store = transaction.objectStore(storeName);
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    };
    
    try {
      const [notesCount, outboxCount, metaCount, syncCount] = await Promise.all([
        getCount('notes'),
        getCount('outbox'),
        getCount('meta'),
        getCount('sync')
      ]);
      
      return {
        notes: notesCount,
        outbox: outboxCount,
        meta: metaCount,
        sync: syncCount,
        total: notesCount + outboxCount + metaCount + syncCount
      };
    } catch (error) {
      console.error('Error getting storage info:', error);
      throw error;
    }
  }
}

// Create a singleton instance
export const storage = new PersistentStorage();