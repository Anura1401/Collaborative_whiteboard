const ADJECTIVES = ['Curious', 'Clever', 'Swift', 'Bright', 'Calm', 'Gentle', 'Brave', 'Wild'];
const ANIMALS = ['Fox', 'Otter', 'Falcon', 'Panda', 'Lynx', 'Badger', 'Dolphin', 'Owl'];

export function generateRandomName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${adj} ${animal}`;
}

export function getClientId(): string {
  if (typeof window === 'undefined') return crypto.randomUUID();

  let id = window.sessionStorage.getItem('whiteboard_client_id');
  if (!id) {
    id = crypto.randomUUID();
    window.sessionStorage.setItem('whiteboard_client_id', id);
  }
  return id;
}

export function getDisplayName(): string {
  if (typeof window === 'undefined') return 'Anonymous';

  let name = window.localStorage.getItem('whiteboard_user_name');
  if (!name || !name.trim()) {
    name = generateRandomName();
    window.localStorage.setItem('whiteboard_user_name', name);
  }
  return name;
}

export function setDisplayName(name: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = name.trim();
  if (trimmed) {
    window.localStorage.setItem('whiteboard_user_name', trimmed);
  }
}
