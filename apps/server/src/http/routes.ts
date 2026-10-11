import type { FastifyInstance } from 'fastify';
import {
  CreateBoardRequestSchema,
  WsTicketRequestSchema,
} from '@whiteboard/shared';
import { createBoard, getBoard } from '../db/boards.js';
import { createTicket } from '../services/tickets.js';
import { getPool } from '../db/pool.js';

export let isShuttingDown = false;

export function setShuttingDown(val: boolean): void {
  isShuttingDown = val;
}

export async function registerRoutes(fastify: FastifyInstance): Promise<void> {
  // Liveness check
  fastify.get('/healthz', async () => {
    return { status: 'ok' };
  });

  // Readiness check
  fastify.get('/readyz', async (_req, reply) => {
    if (isShuttingDown) {
      return reply.code(503).send({ status: 'shutting down' });
    }
    try {
      await getPool().query('SELECT 1');
      return reply.code(200).send({ status: 'ready' });
    } catch {
      return reply.code(503).send({ status: 'database unavailable' });
    }
  });

  // POST /api/boards
  fastify.post('/api/boards', async (req, reply) => {
    const parsed = CreateBoardRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid board request', details: parsed.error.issues });
    }

    const { id, name } = await createBoard(parsed.data.name);
    return reply.code(201).send({ id, name });
  });

  // GET /api/boards/:id
  fastify.get<{ Params: { id: string } }>('/api/boards/:id', async (req, reply) => {
    const { id } = req.params;
    let board = await getBoard(id);
    if (!board) {
      const created = await createBoard('Whiteboard', id);
      board = await getBoard(created.id);
    }
    if (!board) {
      return reply.code(404).send({ error: 'Board not found' });
    }
    return reply.code(200).send({
      id: board.id,
      name: board.name,
      createdAt: board.created_at,
    });
  });

  // POST /api/boards/:id/ws-ticket
  fastify.post<{ Params: { id: string } }>('/api/boards/:id/ws-ticket', async (req, reply) => {
    const { id } = req.params;
    const parsed = WsTicketRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid ticket request', details: parsed.error.issues });
    }

    const board = await getBoard(id);
    if (!board) {
      await createBoard('Whiteboard', id);
    }

    const ticketResult = createTicket(id, parsed.data.clientId, parsed.data.displayName);
    return reply.code(200).send(ticketResult);
  });
}
