export interface Coat {
  id: string;
  name: string;
  fur: string;
  /** Far-side legs and other surfaces in shadow. */
  shade: string;
  /** Tabby markings; null for solid coats. */
  stripe: string | null;
  outline: string;
  innerEar: string;
  nose: string;
  eye: string;
  /** Drawn inside the eye when the iris is a light color. */
  pupil: string | null;
  blush: string;
}

const warmOutline = "#3b2b27";

export const COATS: Record<string, Coat> = {
  ginger: {
    id: "ginger", name: "Ginger",
    fur: "#f7ad63", shade: "#e08c45", stripe: "#e3843c", outline: warmOutline,
    innerEar: "#f6b7a6", nose: "#e98a8f", eye: "#2e2422", pupil: null, blush: "#f59a8f",
  },
  grey: {
    id: "grey", name: "Grey Tabby",
    fur: "#b3b7c2", shade: "#949aa8", stripe: "#858b99", outline: "#34323a",
    innerEar: "#f0b6b8", nose: "#e3959c", eye: "#2b2a30", pupil: null, blush: "#f2a3a8",
  },
  cream: {
    id: "cream", name: "Cream",
    fur: "#f5e6cc", shade: "#dfcaa8", stripe: "#e6cfa9", outline: warmOutline,
    innerEar: "#f6b9ae", nose: "#e99a98", eye: "#2e2422", pupil: null, blush: "#f5a597",
  },
  black: {
    id: "black", name: "Midnight",
    fur: "#3d3a46", shade: "#2c2a34", stripe: null, outline: "#16141b",
    innerEar: "#b9868f", nose: "#9c6a74", eye: "#f2cf55", pupil: "#1b1920", blush: "#c9748a",
  },
};

export const DEFAULT_COAT = COATS.ginger;
