import type { KenoPluginDefinition, KenoPluginSetup } from "../shared/types";

export function definePlugin<Options = void>(
  setup: KenoPluginSetup<Options>,
  meta: { name?: string } = {},
): KenoPluginDefinition<Options> {
  return {
    ...meta,
    setup,
  };
}
