import { config } from '../config.js';
import { Room } from './Room.js';

export class RoomManager {
  private rooms = new Map<string, Room>();
  private inFlightLoads = new Map<string, Promise<Room>>();
  private evictionTimers = new Map<string, NodeJS.Timeout>();

  async getOrLoad(boardId: string): Promise<Room> {
    const existing = this.rooms.get(boardId);
    if (existing) {
      // Cancel eviction timer if active
      this.cancelEviction(boardId);
      return existing;
    }

    const inFlight = this.inFlightLoads.get(boardId);
    if (inFlight) return inFlight;

    const loadPromise = (async () => {
      const room = new Room(boardId, () => this.scheduleEviction(boardId));
      await room.load();
      this.rooms.set(boardId, room);
      this.inFlightLoads.delete(boardId);
      return room;
    })();

    this.inFlightLoads.set(boardId, loadPromise);
    try {
      return await loadPromise;
    } catch (err) {
      this.inFlightLoads.delete(boardId);
      throw err;
    }
  }

  private scheduleEviction(boardId: string): void {
    this.cancelEviction(boardId);
    const timer = setTimeout(() => {
      const room = this.rooms.get(boardId);
      if (room && room.connections.size === 0) {
        this.rooms.delete(boardId);
      }
      this.evictionTimers.delete(boardId);
    }, config.ROOM_IDLE_EVICT_MS);

    this.evictionTimers.set(boardId, timer);
  }

  private cancelEviction(boardId: string): void {
    const timer = this.evictionTimers.get(boardId);
    if (timer) {
      clearTimeout(timer);
      this.evictionTimers.delete(boardId);
    }
  }

  async closeAll(): Promise<void> {
    for (const timer of this.evictionTimers.values()) {
      clearTimeout(timer);
    }
    this.evictionTimers.clear();

    const drainPromises: Promise<void>[] = [];
    for (const room of this.rooms.values()) {
      drainPromises.push(room.queue.drain());
    }
    await Promise.all(drainPromises);
    this.rooms.clear();
  }
}

export const roomManager = new RoomManager();
