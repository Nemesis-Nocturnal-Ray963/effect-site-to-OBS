import type { OverlayConfiguration, OverlayId } from "@obs-effect/shared-types";
import { overlayIds } from "./overlayTypes.js";
import { defaultOverlayConfiguration } from "./OverlayConfigurationJsonRepository.js";

export interface OverlayDefinition {
  overlayId: OverlayId;
  name: string;
  width: number;
  height: number;
  fps: number;
}

export class OverlayRegistry {
  private definitions = new Map<OverlayId, OverlayDefinition>(
    overlayIds.map((overlayId) => [overlayId, toDefinition(defaultOverlayConfiguration(overlayId))])
  );

  list(): OverlayDefinition[] {
    return [...this.definitions.values()];
  }

  get(overlayId: OverlayId): OverlayDefinition {
    return this.definitions.get(overlayId)!;
  }

  applyConfigurations(configurations: OverlayConfiguration[]): void {
    for (const configuration of configurations) {
      this.definitions.set(configuration.overlayId, toDefinition(configuration));
    }
  }

  applyConfiguration(configuration: OverlayConfiguration): void {
    this.definitions.set(configuration.overlayId, toDefinition(configuration));
  }
}

function toDefinition(configuration: OverlayConfiguration): OverlayDefinition {
  return {
    overlayId: configuration.overlayId,
    name: configuration.name,
    width: configuration.width,
    height: configuration.height,
    fps: configuration.fps
  };
}
