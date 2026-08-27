import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { openLocalBrowser } from './browser.js'
import { LazyWebServer } from './lazy-webserver.js'
import { TrajectoryViewerRuntime } from './runtime.js'
import { registerTrajectoryFrontend, startTrajectoryServer } from './server.js'
import { TrajectorySessionGateway } from './session-gateway.js'

export { TrajectoryViewerRuntime } from './runtime.js'
export type { TrajectoryViewerSeams, TrajectoryViewerSnapshot, ViewerOpenResult, ViewerServerHandle } from './runtime.js'

export const name = 'dsh-console-trajectory'
export const inject = ['commands']

async function execute(ctx: Context, runtime: TrajectoryViewerRuntime, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /trajectory' }
  try {
    const result = await runtime.open(invocation.agent.session, invocation.signal)
    return {
      kind: 'success',
      text: result.opened
        ? `Trajectory Viewer opened: ${result.url}`
        : `Could not open a browser. Open this URL manually: ${result.url}`,
    }
  } catch (error) {
    ctx.logger.debug(error instanceof Error ? error : new Error(String(error)))
    return { kind: 'error', text: invocation.signal.aborted ? 'Trajectory Viewer opening was cancelled.' : 'Trajectory Viewer could not be started.' }
  }
}

export async function apply(ctx: Context): Promise<void> {
  const serverFiber = await ctx.plugin(LazyWebServer)
  const server = serverFiber.ctx.get('trajectoryWebServer') as LazyWebServer | undefined
  if (server === undefined) throw new Error('dsh-console-trajectory: web server service is unavailable')
  const gateway = new TrajectorySessionGateway(ctx, server)
  ctx.effect(() => () => { gateway.dispose() }, 'dsh-console-trajectory: session gateway')
  ctx.effect(() => registerTrajectoryFrontend(server), 'dsh-console-trajectory: frontend')
  const runtime = new TrajectoryViewerRuntime({
    registerSession: session => { gateway.register(session) },
    startServer: signal => startTrajectoryServer(server, signal),
    openBrowser: openLocalBrowser,
  })
  ctx.effect(() => async () => { await runtime.dispose() }, 'dsh-console-trajectory: runtime')
  ctx.effect(() => ctx.commands.register({
    name: 'trajectory',
    description: 'open the current session in the local Trajectory Viewer',
    recordInput: false,
    handler: invocation => execute(ctx, runtime, invocation),
  }), 'dsh-console-trajectory: command')
}
