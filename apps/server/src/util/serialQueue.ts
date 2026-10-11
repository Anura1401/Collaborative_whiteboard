export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();

  public run<T>(fn: () => Promise<T> | T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.tail = this.tail.then(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  public async drain(): Promise<void> {
    await this.tail;
  }
}
