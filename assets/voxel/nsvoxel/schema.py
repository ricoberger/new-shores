"""
A small JSON Schema validator for the subset assets/voxel/planned/schema.json
uses (stdlib only): type, enum, const, required, properties,
additionalProperties, items, minItems, maxItems, minimum, maximum,
exclusiveMinimum, pattern, minLength, $ref (local #/$defs) and oneOf.
Unknown keywords are rejected so the schema cannot silently use more.
"""

import re

_SUPPORTED = {
    "$schema", "$id", "$defs", "title", "description", "type", "enum", "const", "required", "properties",
    "additionalProperties", "items", "minItems", "maxItems", "minimum", "maximum", "exclusiveMinimum",
    "pattern", "minLength", "$ref", "oneOf",
}


def check_keywords(node, where="#"):
    """Raises ValueError for a keyword the validator does not implement."""
    if isinstance(node, dict):
        for k, v in node.items():
            if k not in _SUPPORTED:
                raise ValueError(f"schema: unsupported keyword {k!r} at {where}")
            if k in ("properties", "$defs"):
                for name, sub in v.items():
                    check_keywords(sub, f"{where}/{k}/{name}")
            elif k in ("items", "additionalProperties") and isinstance(v, dict):
                check_keywords(v, f"{where}/{k}")
            elif k == "oneOf":
                for i, sub in enumerate(v):
                    check_keywords(sub, f"{where}/oneOf/{i}")


def _type_ok(value, t):
    if t == "object":
        return isinstance(value, dict)
    if t == "array":
        return isinstance(value, list)
    if t == "string":
        return isinstance(value, str)
    if t == "boolean":
        return isinstance(value, bool)
    if t == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if t == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    raise ValueError(f"schema: unknown type {t!r}")


def validate(value, schema, root=None, path="$"):
    """Returns a list of error strings ("<json path>: <problem>"); empty when valid."""
    root = root or schema
    if "$ref" in schema:
        ref = schema["$ref"]
        if not ref.startswith("#/$defs/"):
            raise ValueError(f"schema: only local $defs references are supported, got {ref!r}")
        return validate(value, root["$defs"][ref[len("#/$defs/"):]], root, path)
    errors = []
    if "oneOf" in schema:
        ok = [s for s in schema["oneOf"] if not validate(value, s, root, path)]
        if len(ok) != 1:
            errors.append(f"{path}: must match exactly one of {len(schema['oneOf'])} alternatives")
        return errors
    if "type" in schema and not _type_ok(value, schema["type"]):
        return [f"{path}: expected {schema['type']}, got {type(value).__name__}"]
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: {value!r} is not one of {schema['enum']}")
    if "const" in schema and value != schema["const"]:
        errors.append(f"{path}: must be {schema['const']!r}")
    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            errors.append(f"{path}: shorter than {schema['minLength']}")
        if "pattern" in schema and not re.search(schema["pattern"], value):
            errors.append(f"{path}: {value!r} does not match {schema['pattern']}")
    if _type_ok(value, "number"):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(f"{path}: {value} < minimum {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            errors.append(f"{path}: {value} > maximum {schema['maximum']}")
        if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
            errors.append(f"{path}: {value} must be > {schema['exclusiveMinimum']}")
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            errors.append(f"{path}: fewer than {schema['minItems']} items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errors.append(f"{path}: more than {schema['maxItems']} items")
        if "items" in schema:
            for i, item in enumerate(value):
                errors += validate(item, schema["items"], root, f"{path}[{i}]")
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                errors.append(f"{path}: missing required field {key!r}")
        props = schema.get("properties", {})
        extra = schema.get("additionalProperties", True)
        for key in sorted(value):
            if key in props:
                errors += validate(value[key], props[key], root, f"{path}.{key}")
            elif extra is False:
                errors.append(f"{path}: unknown field {key!r}")
            elif isinstance(extra, dict):
                errors += validate(value[key], extra, root, f"{path}.{key}")
    return errors
