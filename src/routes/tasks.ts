import { Router, Request, Response } from 'express';
import { TaskService } from '../services/taskService';
import { Database } from '../db/database';

export function createTaskRouter(db: Database): Router {
  const router = Router();
  const taskService = new TaskService(db);

  // Get all tasks
  router.get('/', async (req: Request, res: Response): Promise<void> => {
    try {
      void req;
      const tasks = await taskService.getAllTasks();
      res.json(tasks);
    } catch {
      res.status(500).json({ error: 'Failed to fetch tasks' });
    }
  });

  // Get single task
  router.get('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const task = await taskService.getTask(req.params.id);
      if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }
      res.json(task);
    } catch {
      res.status(500).json({ error: 'Failed to fetch task' });
    }
  });

  // Create task
  router.post('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const { title, description, completed } = req.body || {};
      if (!title || typeof title !== 'string') {
        res.status(400).json({ error: 'title is required' });
        return;
      }
      const task = await taskService.createTask({ title, description, completed });
      res.status(201).json(task);
    } catch {
      res.status(500).json({ error: 'Failed to create task' });
    }
  });

  // Update task
  router.put('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const { title, description, completed } = req.body || {};
      const updated = await taskService.updateTask(req.params.id, { title, description, completed });
      if (!updated) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }
      res.json(updated);
    } catch {
      res.status(500).json({ error: 'Failed to update task' });
    }
  });

  // Delete task
  router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const ok = await taskService.deleteTask(req.params.id);
      if (!ok) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Failed to delete task' });
    }
  });

  return router;
}