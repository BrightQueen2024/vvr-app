export type StateMachineState = 'IDLE' | 'SYNCING' | 'COOLING' | 'STOPPED';

export interface ISyncStateMachine {
  /**
   * Starts the sync engine. Runs the execution loop in the background.
   */
  startSyncLoop(): void;

  /**
   * Gracefully requests the sync engine to stop.
   */
  stopSyncLoop(): Promise<void>;

  /**
   * Returns the current state of the sync engine.
   */
  getStatus(): StateMachineState;
}
