import { v4 as uuidv4 } from 'uuid';
import { Task } from '../types';
import { Database } from '../db/database';

export class TaskService {
  constructor(private db: Database) {}

  async createTask(taskData: Partial<Task>): Promise<Task> {
    const id = uuidv4();
    const now = new Date();
    const title = taskData.title ?? '';
    const description = taskData.description ?? null;
    const completed = taskData.completed ?? false;
    const isDeleted = false;
    const syncStatus: Task['sync_status'] = 'pending';

    await this.db.run(
      `INSERT INTO tasks (id, title, description, completed, created_at, updated_at, is_deleted, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        title,
        description,
        completed ? 1 : 0,
        now.toISOString(),
        now.toISOString(),
        isDeleted ? 1 : 0,
        syncStatus,
      ]
    );

    // Add to sync queue as create
    await this.db.run(
      `INSERT INTO sync_queue (id, task_id, operation, data)
       VALUES (?, ?, ?, ?)` ,
      [uuidv4(), id, 'create', JSON.stringify({ id, title, description, completed, is_deleted: isDeleted })]
    );

    const task: Task = {
      id,
      title,
      description: description ?? undefined,
      completed,
      created_at: now,
      updated_at: now,
      is_deleted: isDeleted,
      sync_status: syncStatus,
    };

    return task;
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task | null> {
    const existing = await this.db.get('SELECT * FROM tasks WHERE id = ?', [id]);
    if (!existing) return null;

    const now = new Date();
    const newTitle = updates.title ?? existing.title;
    const newDescription = updates.description ?? existing.description;
    const newCompleted = updates.completed ?? (existing.completed === 1);

    await this.db.run(
      `UPDATE tasks SET title = ?, description = ?, completed = ?, updated_at = ?, sync_status = ? WHERE id = ?`,
      [
        newTitle,
        newDescription,
        newCompleted ? 1 : 0,
        now.toISOString(),
        'pending',
        id,
      ]
    );

    await this.db.run(
      `INSERT INTO sync_queue (id, task_id, operation, data) VALUES (?, ?, ?, ?)` ,
      [uuidv4(), id, 'update', JSON.stringify({ title: newTitle, description: newDescription, completed: newCompleted })]
    );

    const updated: Task = {
      id,
      title: newTitle,
      description: newDescription ?? undefined,
      completed: newCompleted,
      created_at: new Date(existing.created_at),
      updated_at: now,
      is_deleted: existing.is_deleted === 1 ? true : false,
      sync_status: 'pending',
      server_id: existing.server_id ?? undefined,
      last_synced_at: existing.last_synced_at ? new Date(existing.last_synced_at) : undefined,
    };

    return updated;
  }

  async deleteTask(id: string): Promise<boolean> {
    const existing = await this.db.get('SELECT * FROM tasks WHERE id = ?', [id]);
    if (!existing) return false;

    const now = new Date();
    await this.db.run(
      `UPDATE tasks SET is_deleted = 1, updated_at = ?, sync_status = ? WHERE id = ?`,
      [now.toISOString(), 'pending', id]
    );

    await this.db.run(
      `INSERT INTO sync_queue (id, task_id, operation, data) VALUES (?, ?, ?, ?)` ,
      [uuidv4(), id, 'delete', JSON.stringify({ id })]
    );

    return true;
  }

  async getTask(id: string): Promise<Task | null> {
    const row = await this.db.get('SELECT * FROM tasks WHERE id = ? AND is_deleted = 0', [id]);
    if (!row) return null;
    return this.mapRowToTask(row);
  }

  async getAllTasks(): Promise<Task[]> {
    const rows = await this.db.all('SELECT * FROM tasks WHERE is_deleted = 0');
    return rows.map((r) => this.mapRowToTask(r));
  }

  async getTasksNeedingSync(): Promise<Task[]> {
    const rows = await this.db.all("SELECT * FROM tasks WHERE sync_status IN ('pending','error')");
    return rows.map((r) => this.mapRowToTask(r));
  }

  private mapRowToTask(row: any): Task {
    return {
      id: row.id,
      title: row.title,
      description: row.description ?? undefined,
      completed: row.completed === 1,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      is_deleted: row.is_deleted === 1,
      sync_status: row.sync_status,
      server_id: row.server_id ?? undefined,
      last_synced_at: row.last_synced_at ? new Date(row.last_synced_at) : undefined,
    };
  }
}