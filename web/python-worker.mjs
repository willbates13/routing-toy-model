import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs";

const pyodide = await loadPyodide({
  indexURL: "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/",
});

self.postMessage({ type: "ready" });

self.onmessage = async (event) => {
  const message = event.data || {};
  if (message.type !== "run") return;

  try {
    pyodide.globals.set("_aoa_code", message.code);
    pyodide.globals.set("_aoa_skus_json", JSON.stringify(message.skus));
    pyodide.globals.set("_aoa_context_json", JSON.stringify(message.context));

    await pyodide.runPythonAsync(`
import json
import builtins

_aoa_allowed_names = (
    "abs", "all", "any", "bool", "dict", "enumerate", "float", "int",
    "len", "list", "max", "min", "range", "round", "sorted", "sum",
    "tuple", "zip"
)
_aoa_safe_builtins = {name: getattr(builtins, name) for name in _aoa_allowed_names}
_aoa_namespace = {"__builtins__": _aoa_safe_builtins}
exec(_aoa_code, _aoa_namespace)
if "set_targets" not in _aoa_namespace or not callable(_aoa_namespace["set_targets"]):
    raise ValueError("Define a function named set_targets(skus, context).")

_aoa_skus = json.loads(_aoa_skus_json)
_aoa_context = json.loads(_aoa_context_json)
_aoa_result = _aoa_namespace["set_targets"](_aoa_skus, _aoa_context)
_aoa_result_json = json.dumps(_aoa_result)
    `);

    const result = JSON.parse(pyodide.globals.get("_aoa_result_json"));
    self.postMessage({ type: "result", id: message.id, ok: true, result });
  } catch (error) {
    self.postMessage({
      type: "result",
      id: message.id,
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
  } finally {
    [
      "_aoa_code",
      "_aoa_skus_json",
      "_aoa_context_json",
      "_aoa_namespace",
      "_aoa_allowed_names",
      "_aoa_safe_builtins",
      "_aoa_skus",
      "_aoa_context",
      "_aoa_result",
      "_aoa_result_json",
    ].forEach((name) => pyodide.globals.delete(name));
  }
};
