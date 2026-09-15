import type { EffectDefinition } from "@obs-effect/shared-types";
import { fallingImageEffectDefinition } from "./builtins/fallingImage.js";
import { flashEffectDefinition } from "./builtins/flash.js";
import { giftComboTextEffectDefinition } from "./builtins/giftComboText.js";
import { pitchingMachineBallEffectDefinition } from "./builtins/pitchingMachineBall.js";
import { puyoGameEffectDefinition } from "./builtins/puyoGame.js";
import { simpleMediaEffectDefinition } from "./builtins/simpleMedia.js";

export const effectDefinitions: EffectDefinition[] = [
  flashEffectDefinition,
  fallingImageEffectDefinition,
  simpleMediaEffectDefinition,
  pitchingMachineBallEffectDefinition,
  puyoGameEffectDefinition,
  giftComboTextEffectDefinition
];

export function findEffectDefinition(effectDefinitionId: string): EffectDefinition | undefined {
  return effectDefinitions.find((definition) => definition.id === effectDefinitionId);
}
