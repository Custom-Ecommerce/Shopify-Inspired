/**
 * Scopes a theme's stylesheet under html[data-theme="<slug>"] so it cannot leak into other themes or the platform's
 * own CSS, and the platform's CSS cannot reach it through shared variable names. It runs after Tailwind and only on
 * files under themes/<slug>/src/styles/. @keyframes bodies and rules already carrying the scope are left alone.
 */
const SCOPED_FILE = /themes\/([a-z0-9-]+)\/src\/styles\//;

function scopeSelector(selector, scope) {
  const sel = selector.trim();
  if (sel.startsWith(scope)) return sel;
  if (sel === ":root" || sel === ":host" || sel === "html") return scope;
  if (/^html[\s.:#\[]/.test(sel)) return scope + sel.slice(4);
  if (sel === "body" || /^body[\s.:#\[]/.test(sel)) return scope + " " + sel;
  if (sel.startsWith(":root") || sel.startsWith(":host")) return scope + sel.replace(/^:(root|host)/, "");
  return scope + " " + sel;
}

module.exports = () => ({
  postcssPlugin: "scope-theme",
  Once(root, { result }) {
    const from = String((result.opts && result.opts.from) || "").replace(/\\/g, "/");
    const match = SCOPED_FILE.exec(from);
    if (!match) return;
    const scope = 'html[data-theme="' + match[1] + '"]';
    root.walkRules((rule) => {
      const parent = rule.parent;
      if (parent && parent.type === "atrule" && /keyframes$/i.test(parent.name)) return;
      rule.selectors = Array.from(new Set(rule.selectors.map((s) => scopeSelector(s, scope))));
    });
  },
});
module.exports.postcss = true;
