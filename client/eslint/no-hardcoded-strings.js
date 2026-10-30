// Local ESLint rule (D-061): player-facing text lives in the message
// catalogue (src/i18n), never in components. Flags JSX text and string
// literals that read as prose in src/ui and src/almanac:
//
//   - JSX text with letters; string literals and template pieces with
//     letters that are not "code-like" (a code-like string is one word
//     starting with a lower-case letter, a digit or a symbol: "paused",
//     "info-panel", "#fff", "10px", "data-testid");
//   - and, for the text attributes (title, alt, placeholder, aria-label,
//     aria-description, aria-valuetext, aria-roledescription), every
//     string with letters.
//
// Not flagged: the key argument of t()/tOr(), import/export sources,
// property keys, computed member keys, comparisons, switch cases, type
// positions, `new Error(…)` messages, console calls, the `style` prop,
// className/class/data-*/href/src/id/key/role/type/name/rel/target and
// other non-text JSX attributes.
//
// Escape: a `// i18n-ignore` comment on the same line (or the line
// before). Use it sparingly and say why.

const LETTERS = /\p{L}/u;
const CODE_LIKE = /^[a-z0-9#._:/\-+()%,[\]*]+$|^[a-z][A-Za-z0-9_.-]*$/;
const TEXT_ATTRIBUTES = new Set(["title", "alt", "placeholder", "aria-label", "aria-description", "aria-valuetext", "aria-roledescription"]);
const SKIPPED_ATTRIBUTES = new Set(["className", "class", "style", "href", "src", "id", "key", "role", "type", "name", "rel", "target", "htmlFor", "autoComplete", "inputMode", "pattern", "viewBox", "d", "fill", "stroke", "points", "transform"]);
const TRANSLATE = new Set(["t", "tOr", "tRich"]);

// Selectors, media queries and the like are code even with a space in them.
const CODE_SHAPED = /^[([]|[[\]{}=;]|^\w+\([^)]*\)$/;

function isProse(text) {
  return LETTERS.test(text) && !CODE_LIKE.test(text) && !CODE_SHAPED.test(text.trim());
}

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      text: "Hardcoded UI text: move it to the message catalogue (src/i18n/en.ts, de.ts) and use t().",
    },
  },
  create(context) {
    const source = context.sourceCode;
    const ignored = (node) => {
      const line = node.loc.start.line;
      return source.getAllComments().some((c) => /i18n-ignore/.test(c.value) && (c.loc.end.line === line || c.loc.end.line === line - 1));
    };
    const report = (node) => {
      if (!ignored(node)) context.report({ node, messageId: "text" });
    };
    const inStyleOrSkipped = (node) => {
      for (let p = node.parent; p; p = p.parent) {
        if (p.type === "JSXAttribute") {
          const name = p.name.type === "JSXNamespacedName" ? `${p.name.namespace.name}:${p.name.name.name}` : p.name.name;
          if (TEXT_ATTRIBUTES.has(name)) return false;
          return SKIPPED_ATTRIBUTES.has(name) || name.startsWith("data-") || name.startsWith("aria-");
        }
        if (p.type === "JSXElement" || p.type === "Program") return false;
      }
      return false;
    };
    const textAttribute = (node) => {
      for (let p = node.parent; p; p = p.parent) {
        if (p.type === "JSXAttribute") return TEXT_ATTRIBUTES.has(p.name.name);
        if (p.type === "JSXElement" || p.type === "Program") return false;
      }
      return false;
    };
    const skippedContext = (node) => {
      const p = node.parent;
      if (!p) return false;
      switch (p.type) {
        case "ImportDeclaration":
        case "ExportAllDeclaration":
        case "ExportNamedDeclaration":
        case "ImportExpression":
        case "TSLiteralType":
        case "TSEnumMember":
        case "TSImportType":
        case "TSExternalModuleReference":
        case "TSModuleDeclaration":
        case "SwitchCase":
          return true;
        case "Property":
        case "PropertyDefinition":
        case "MethodDefinition":
          return p.key === node && !p.computed ? true : false;
        case "MemberExpression":
          return p.computed && p.property === node;
        case "BinaryExpression":
          return ["===", "!==", "==", "!=", "in"].includes(p.operator);
        case "CallExpression": {
          const name = p.callee.type === "Identifier" ? p.callee.name : p.callee.type === "MemberExpression" && p.callee.property.type === "Identifier" ? p.callee.property.name : "";
          if (TRANSLATE.has(name) && p.arguments[0] === node) return true;
          if (p.callee.type === "MemberExpression" && p.callee.object.type === "Identifier" && p.callee.object.name === "console") return true;
          return false;
        }
        case "AssignmentExpression":
          // element.style.transform = `translate(…)`
          return p.right === node && p.left.type === "MemberExpression" && p.left.object.type === "MemberExpression" && p.left.object.property.name === "style";
        case "NewExpression":
          return p.callee.type === "Identifier" && /Error$/.test(p.callee.name);
        default:
          return false;
      }
    };
    return {
      JSXText(node) {
        if (LETTERS.test(node.value.replace(/&[a-z]+;|&#\d+;/gi, ""))) report(node);
      },
      Literal(node) {
        if (typeof node.value !== "string") return;
        if (node.parent.type === "JSXAttribute") {
          const name = node.parent.name.name;
          if (TEXT_ATTRIBUTES.has(name) && LETTERS.test(node.value)) report(node);
          return;
        }
        if (!isProse(node.value) || skippedContext(node)) return;
        if (inStyleOrSkipped(node) && !textAttribute(node)) return;
        report(node);
      },
      TemplateElement(node) {
        const text = node.value.cooked ?? "";
        if (!isProse(text)) return;
        const tpl = node.parent;
        if (tpl.parent.type === "TaggedTemplateExpression" || tpl.parent.type === "TSLiteralType") return;
        if (skippedContext(tpl)) return;
        if (inStyleOrSkipped(tpl) && !textAttribute(tpl)) return;
        report(node);
      },
    };
  },
};
