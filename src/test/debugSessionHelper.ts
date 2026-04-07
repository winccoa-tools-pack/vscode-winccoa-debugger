/**
 * DebugSessionHelper
 *
 * Test utility that wraps the VS Code debug API for E2E debugger tests.
 *
 * It registers a `DebugAdapterTracker` (via `registerDebugAdapterTrackerFactory`)
 * that intercepts every raw DAP message exchanged between VS Code and the adapter.
 * This lets tests:
 *   - Wait for specific DAP events from the adapter (e.g. 'stopped', 'terminated')
 *   - Issue arbitrary DAP requests via `session.customRequest()` and get the response
 *
 * Usage
 * -----
 * ```typescript
 * const helper = new DebugSessionHelper('winccoa');
 * await helper.startSession(workspaceFolder, launchConfig);
 * await helper.waitForEvent('stopped', 10_000);
 * const st = await helper.request('stackTrace', { threadId: 1 });
 * await helper.dispose();
 * ```
 */

import * as vscode from 'vscode';

export interface DapMessage {
    type: 'event' | 'request' | 'response';
    event?: string;
    command?: string;
    body?: unknown;
    success?: boolean;
}

/**
 * Manages a single VS Code debug session and tracks all DAP messages
 * for assertion in E2E tests.
 */
export class DebugSessionHelper {
    /** All messages received FROM the adapter (events + responses). */
    private readonly received: DapMessage[] = [];
    /** Pending waiters: functions to call when a new message arrives. */
    private readonly waiters: Array<() => void> = [];

    private session: vscode.DebugSession | undefined;
    private trackerDisposable: vscode.Disposable | undefined;
    private sessionDisposable: vscode.Disposable | undefined;
    private terminated = false;

    constructor(private readonly debugType: string) {}

    // ─── public API ──────────────────────────────────────────────────────────

    /**
     * Starts a debug session and waits until:
     *   1. The VS Code session object exists (`onDidStartDebugSession`)
     *   2. The adapter has sent its `initialized` event
     *   3. VS Code has finished sending breakpoints and `configurationDone`
     *      (signalled by the adapter's resulting `continued` or `stopped` event)
     *
     * IMPORTANT: Call `vscode.debug.addBreakpoints()` BEFORE this so that
     * VS Code sends `setBreakpoints` automatically after `InitializedEvent`.
     *
     * After this returns, all registered breakpoints have been sent to the
     * adapter and the adapter is ready. The caller can then start the
     * target CTRL manager via `lifecycle.startManagerByNum(n)`.
     */
    async startSession(
        workspaceFolder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        timeoutMs = 20_000,
    ): Promise<void> {
        // Register tracker BEFORE starting the session so we don't miss early events.
        this.trackerDisposable = vscode.debug.registerDebugAdapterTrackerFactory(
            this.debugType,
            {
                createDebugAdapterTracker: (_s) => ({
                    onDidSendMessage: (msg: DapMessage) => {
                        this.received.push(msg);
                        // Notify all pending waiters
                        const waiters = this.waiters.splice(0);
                        for (const fn of waiters) fn();
                    },
                }),
            },
        );

        // Track when the session starts so we can hold a reference.
        const startedPromise = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error(`Timed out (${timeoutMs}ms) waiting for debug session to start`)),
                timeoutMs,
            );
            this.sessionDisposable = vscode.debug.onDidStartDebugSession((s) => {
                if (s.type === this.debugType) {
                    clearTimeout(timer);
                    this.session = s;
                    this.sessionDisposable?.dispose();
                    resolve();
                }
            });
        });

        const started = await vscode.debug.startDebugging(workspaceFolder, config);
        if (!started) {
            throw new Error('vscode.debug.startDebugging returned false — session did not start');
        }

        await startedPromise;

        // Wait for configurationDone cycle to complete:
        // adapter sends 'initialized' → VS Code sends setBreakpoints → configurationDone
        // → adapter sends 'continued' (or 'stopped' for stopOnEntry).
        // We peek at received events without consuming them so waitForEvent() still works.
        await this.waitForConfigurationDone(timeoutMs);
    }

    /**
     * Waits until the adapter has processed `configurationDone` — indicated by
     * a `continued` or `stopped` event (whichever comes first after `initialized`).
     * Does NOT consume the event so `waitForEvent()` callers still see it.
     */
    private waitForConfigurationDone(timeoutMs: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const deadline = Date.now() + timeoutMs;

            const check = () => {
                // After configurationDone the adapter always sends either
                // 'continued' (normal attach) or 'stopped' (stopOnEntry).
                const done = this.received.some(
                    (m) => m.type === 'event' && (m.event === 'continued' || m.event === 'stopped'),
                );
                if (done) {
                    resolve();
                    return true;
                }
                return false;
            };

            if (check()) return;

            const timer = setTimeout(() => {
                const pendingIdx = this.waiters.indexOf(poll);
                if (pendingIdx !== -1) this.waiters.splice(pendingIdx, 1);
                reject(new Error(
                    `Timed out (${timeoutMs}ms) waiting for configurationDone cycle. ` +
                    `Received: ${this.received.filter(m => m.type === 'event').map(m => m.event).join(', ')}`,
                ));
            }, deadline - Date.now());

            const poll = () => {
                if (check()) {
                    clearTimeout(timer);
                } else {
                    this.waiters.push(poll);
                }
            };
            this.waiters.push(poll);
        });
    }

    /**
     * Waits for a DAP event of the given type to arrive from the adapter.
     * Returns the event message body.
     *
     * @param eventName  e.g. 'stopped', 'continued', 'terminated', 'output'
     * @param timeoutMs  how long to wait before rejecting
     */
    waitForEvent(eventName: string, timeoutMs = 10_000): Promise<DapMessage> {
        return new Promise((resolve, reject) => {
            const check = () => {
                // Search from the beginning — the waiter may fire multiple times
                const idx = this.received.findIndex(
                    (m) => m.type === 'event' && m.event === eventName,
                );
                if (idx !== -1) {
                    const [msg] = this.received.splice(idx, 1);
                    resolve(msg);
                    return true;
                }
                return false;
            };

            if (check()) return;

            const timer = setTimeout(() => {
                const pendingIdx = this.waiters.indexOf(poll);
                if (pendingIdx !== -1) this.waiters.splice(pendingIdx, 1);
                reject(
                    new Error(
                        `Timed out after ${timeoutMs}ms waiting for DAP event "${eventName}". ` +
                        `Received events: ${this.received.filter(m=>m.type==='event').map(m=>m.event).join(', ')}`,
                    ),
                );
            }, timeoutMs);

            const poll = () => {
                if (check()) clearTimeout(timer);
                // else: re-register — the next notify will call us again
                else this.waiters.push(poll);
            };
            this.waiters.push(poll);
        });
    }

    /**
     * Send a DAP request to the adapter and return the response body.
     * Uses `session.customRequest()` which works for all standard + custom requests.
     */
    async request<T = unknown>(command: string, args?: unknown): Promise<T> {
        if (!this.session) {
            throw new Error('No active debug session — call startSession() first');
        }
        return this.session.customRequest(command, args) as Promise<T>;
    }

    /**
     * Stop the active debug session if still running and clean up.
     */
    async dispose(): Promise<void> {
        if (this.session && !this.terminated) {
            try {
                await vscode.debug.stopDebugging(this.session);
            } catch {
                // ignore if already stopped
            }
        }
        this.trackerDisposable?.dispose();
        this.sessionDisposable?.dispose();
        this.waiters.splice(0);
    }

    /** Whether a `terminated` event has been observed. */
    isTerminated(): boolean {
        return this.terminated || this.received.some((m) => m.type === 'event' && m.event === 'terminated');
    }
}
