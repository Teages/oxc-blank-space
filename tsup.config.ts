export default {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: false,
    target: "node18",
    outExtension({ format }) {
        return { js: format === "esm" ? ".js" : ".cjs" };
    },
};
