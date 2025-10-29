import axios from 'axios';
import { Task, SyncQueueItem, SyncResult, BatchSyncRequest, BatchSyncResponse } from '../types';
import { Database } from '../db/database';
import { TaskService } from './taskService';

export class SyncService {
  private apiUrl: string;
  
  constructor(
    private db: Database,
    private taskService: TaskService,
    apiUrl: string = process.env.API_BASE_URL || 'http://localhost:3000/api'
  ) {
    this.apiUrl = apiUrl;
  }

  async sync(): Promise<SyncResult> {
    const items = await this.db.all('SELECT * FROM sync_queue ORDER BY created_at');
    const batchSize = Number(process.env.SYNC_BATCH_SIZE || 50);

    let synced = 0;
    let failed = 0;
    const errors: { task_id: string; operation: string; error: string; timestamp: Date }[] = [];

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize).map((r: any) => this.mapRowToQueueItem(r));
      try {
        const resp = await this.processBatch(batch);
        for (const processed of resp.processed_items) {
          const source = batch.find((b) => b.task_id === processed.client_id);
          if (!source) continue;
          if (processed.status === 'success') {
            await this.updateSyncStatus(processed.client_id, 'synced', { server_id: processed.server_id });
            // Remove all queue entries for this task (simple approach)
            await this.db.run('DELETE FROM sync_queue WHERE task_id = ?', [processed.client_id]);
            synced += 1;
          } else {
            await this.handleSyncError(source, new Error(processed.error || 'Unknown error'));
            await this.updateSyncStatus(processed.client_id, 'error');
            failed += 1;
            errors.push({ task_id: processed.client_id, operation: source.operation, error: processed.error || 'error', timestamp: new Date() });
          }
        }
      } catch (e: any) {
        // Batch failed; mark all as failed and increment retry
        for (const it of batch) {
          await this.handleSyncError(it, e);
          await this.updateSyncStatus(it.task_id, 'error');
          failed += 1;
          errors.push({ task_id: it.task_id, operation: it.operation, error: e?.message || 'error', timestamp: new Date() });
        }
      }
    }

    return {
      success: failed === 0,
      synced_items: synced,
      failed_items: failed,
      errors,
    };
  }

  async addToSyncQueue(taskId: string, operation: 'create' | 'update' | 'delete', data: Partial<Task>): Promise<void> {
    const id = (global as any).crypto?.randomUUID ? (global as any).crypto.randomUUID() : undefined;
    const queueId = id || require('uuid').v4();
    await this.db.run(
      `INSERT INTO sync_queue (id, task_id, operation, data) VALUES (?, ?, ?, ?)` ,
      [queueId, taskId, operation, JSON.stringify(data || {})]
    );
  }

  private async processBatch(items: SyncQueueItem[]): Promise<BatchSyncResponse> {
    const requestBody: BatchSyncRequest = {
      items,
      client_timestamp: new Date(),
    };
    const { data } = await axios.post(`${this.apiUrl}/batch`, requestBody);
    return data as BatchSyncResponse;
  }

  private async resolveConflict(localTask: Task, serverTask: Task): Promise<Task> {
    const localUpdated = new Date(localTask.updated_at).getTime();
    const serverUpdated = new Date(serverTask.updated_at).getTime();
    return localUpdated >= serverUpdated ? localTask : serverTask;
  }

  private async updateSyncStatus(taskId: string, status: 'synced' | 'error', serverData?: Partial<Task>): Promise<void> {
    const now = new Date();
    const serverId = serverData?.server_id;
    if (status === 'synced') {
      await this.db.run(
        `UPDATE tasks SET sync_status = 'synced', last_synced_at = ?, server_id = COALESCE(?, server_id) WHERE id = ?`,
        [now.toISOString(), serverId ?? null, taskId]
      );
    } else {
      await this.db.run(
        `UPDATE tasks SET sync_status = 'error' WHERE id = ?`,
        [taskId]
      );
    }
  }

  private async handleSyncError(item: SyncQueueItem, error: Error): Promise<void> {
    const newRetry = (item.retry_count ?? 0) + 1;
    await this.db.run(
      `UPDATE sync_queue SET retry_count = ?, error_message = ? WHERE id = ?`,
      [newRetry, error.message, item.id]
    );
  }

  async checkConnectivity(): Promise<boolean> {
    // TODO: Check if server is reachable
    // 1. Make a simple health check request
    // 2. Return true if successful, false otherwise
    try {
      await axios.get(`${this.apiUrl}/health`, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}