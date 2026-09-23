/**
 * Colour palette. `id` is what Claude uses; `ldraw` is the LDraw colour code;
 * `hex` is used by the 3D viewer. Add colours here to make them available.
 */
export interface ColorDef {
  id: string;
  name: string;
  ldraw: number;
  hex: string;
  transparent?: boolean;
}

export const COLORS: ColorDef[] = [
  { id: "white", name: "White", ldraw: 15, hex: "#f2f3f2" },
  { id: "black", name: "Black", ldraw: 0, hex: "#1b2a34" },
  { id: "red", name: "Red", ldraw: 4, hex: "#c91a09" },
  { id: "dark_red", name: "Dark Red", ldraw: 320, hex: "#720e0f" },
  { id: "orange", name: "Orange", ldraw: 25, hex: "#fe8a18" },
  { id: "yellow", name: "Yellow", ldraw: 14, hex: "#f2cd37" },
  { id: "lime", name: "Lime", ldraw: 27, hex: "#bbe90b" },
  { id: "green", name: "Green", ldraw: 2, hex: "#237841" },
  { id: "dark_green", name: "Dark Green", ldraw: 288, hex: "#184632" },
  { id: "blue", name: "Blue", ldraw: 1, hex: "#0055bf" },
  { id: "dark_blue", name: "Dark Blue", ldraw: 272, hex: "#0a3463" },
  { id: "medium_azure", name: "Medium Azure", ldraw: 322, hex: "#36aebf" },
  { id: "light_gray", name: "Light Bluish Gray", ldraw: 71, hex: "#a0a5a9" },
  { id: "dark_gray", name: "Dark Bluish Gray", ldraw: 72, hex: "#6c6e68" },
  { id: "tan", name: "Tan", ldraw: 19, hex: "#e4cd9e" },
  { id: "dark_tan", name: "Dark Tan", ldraw: 28, hex: "#958a73" },
  { id: "reddish_brown", name: "Reddish Brown", ldraw: 70, hex: "#582a12" },
  { id: "pink", name: "Bright Pink", ldraw: 29, hex: "#e4adc8" },
  { id: "purple", name: "Dark Purple", ldraw: 85, hex: "#3f3691" },
  { id: "trans_clear", name: "Trans Clear", ldraw: 47, hex: "#fcfcfc", transparent: true },
  { id: "trans_blue", name: "Trans Light Blue", ldraw: 43, hex: "#aee9ef", transparent: true },
];

export const COLOR_MAP: ReadonlyMap<string, ColorDef> = new Map(COLORS.map((c) => [c.id, c]));
export const COLOR_IDS = COLORS.map((c) => c.id) as [string, ...string[]];
