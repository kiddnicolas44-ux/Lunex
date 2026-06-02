// ══════════════════════════════════════════════════════════════════════════════
// PROMETHEUS OBFUSCATION ENGINE (real Prometheus, run via wasmoon Lua VM)
// Ported from the obfuscate-and-show web app's luaEngine.ts so the server
// produces identical output. Loads the Lua sources from ./lua on disk.
// ══════════════════════════════════════════════════════════════════════════════
const fs   = require("fs");
const path = require("path");
const { LuaFactory } = require("wasmoon");

const LUA_DIR = path.join(__dirname, "lua");

const MODULE_PATHS = [
    "lua/colors.lua",
    "lua/config.lua",
    "lua/logger.lua",
    "lua/presets.lua",
    "lua/highlightlua.lua",
    "lua/prometheus.lua",
    "lua/prometheus/ast.lua",
    "lua/prometheus/bit.lua",
    "lua/prometheus/enums.lua",
    "lua/prometheus/parser.lua",
    "lua/prometheus/pipeline.lua",
    "lua/prometheus/randomLiterals.lua",
    "lua/prometheus/randomStrings.lua",
    "lua/prometheus/scope.lua",
    "lua/prometheus/step.lua",
    "lua/prometheus/steps.lua",
    "lua/prometheus/tokenizer.lua",
    "lua/prometheus/unparser.lua",
    "lua/prometheus/util.lua",
    "lua/prometheus/visitast.lua",
    "lua/prometheus/compiler/compiler.lua",
    "lua/prometheus/namegenerators.lua",
    "lua/prometheus/namegenerators/Il.lua",
    "lua/prometheus/namegenerators/confuse.lua",
    "lua/prometheus/namegenerators/mangled.lua",
    "lua/prometheus/namegenerators/mangled_shuffled.lua",
    "lua/prometheus/namegenerators/number.lua",
    "lua/prometheus/steps/AddVararg.lua",
    "lua/prometheus/steps/AntiTamper.lua",
    "lua/prometheus/steps/ConstantArray.lua",
    "lua/prometheus/steps/EncryptStrings.lua",
    "lua/prometheus/steps/NumbersToExpressions.lua",
    "lua/prometheus/steps/ProxifyLocals.lua",
    "lua/prometheus/steps/SplitStrings.lua",
    "lua/prometheus/steps/Vmify.lua",
    "lua/prometheus/steps/Watermark.lua",
    "lua/prometheus/steps/WatermarkCheck.lua",
    "lua/prometheus/steps/WrapInFunction.lua",
];

let enginePromise = null;

async function initEngine() {
    const factory = new LuaFactory();

    for (const rel of MODULE_PATHS) {
        const abs = path.join(__dirname, rel);
        const content = fs.readFileSync(abs, "utf8");
        await factory.mountFile(`/${rel}`, content);
    }

    const lua = await factory.createEngine();

    await lua.doString(`
        arg = arg or {}
        unpack = unpack or table.unpack
        loadstring = loadstring or load

        package.path = "/lua/?.lua;/lua/?/init.lua;" .. (package.path or "")

        local ok, err = pcall(function()
            _G._Prometheus = require("prometheus")
            _G._Prometheus.Logger.logLevel = _G._Prometheus.Logger.LogLevel.Error
        end)
        if not ok then
            error("Failed to initialise Prometheus: " .. tostring(err))
        end

        function _G._obfuscate(code, presetName)
            local preset = _G._Prometheus.Presets[presetName]
            if not preset then
                return false, "Unknown preset: " .. tostring(presetName)
            end
            local pipeline = _G._Prometheus.Pipeline:fromConfig(preset)
            return pcall(function()
                return pipeline:apply(code)
            end)
        end
    `);

    return lua;
}

function getEngine() {
    if (!enginePromise) {
        enginePromise = initEngine().catch((err) => {
            enginePromise = null;
            throw err;
        });
    }
    return enginePromise;
}

// Run Prometheus over `code` with the given preset name
// (Minify | Weak | Medium | Strong | Maximum).
async function obfuscate(code, preset) {
    const lua = await getEngine();

    lua.global.set("_input_code", code);
    lua.global.set("_input_preset", preset);

    await lua.doString("_result_ok, _result_value = _obfuscate(_input_code, _input_preset)");

    const ok    = lua.global.get("_result_ok");
    const value = lua.global.get("_result_value");

    if (!ok) throw new Error(typeof value === "string" ? value : "Obfuscation failed");
    if (typeof value !== "string") throw new Error("Unexpected result type from obfuscator");
    return value;
}

module.exports = { obfuscate, preloadEngine: getEngine };
