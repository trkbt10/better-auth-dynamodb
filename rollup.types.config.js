/**
 * @file Bundle declarations for both ESM and CommonJS consumers.
 */
import { dts } from "rollup-plugin-dts";

export default {
  input: "dist/index.d.ts",
  output: [
    { file: "dist/index.d.ts", format: "es" },
    { file: "dist/index.d.cts", format: "es" },
  ],
  plugins: [dts()],
};
