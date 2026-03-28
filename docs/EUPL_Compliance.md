# EUPL Compliance for Plugins

This document explains how to develop and distribute plugins for this CMS while maintaining **EUPL v1.2 compliance** and ensuring that your plugin code remains independent of the "Copyleft" (Viral) clause of the CMS license.

---

## 1. Context: The EUPL v1.2 License

The CMS core is licensed under the **European Union Public Licence v1.2 (EUPL-1.2)**. 

### The Copyleft Clause (Article 5)
The EUPL includes a "copyleft" provision: if you create a **Derivative Work** based on the Original Work (the CMS) and distribute it, that derivative work must also be licensed under the EUPL.

### How Plugins Avoid Being "Derivative Works"
To ensure plugins are considered **Separate Works** (and thus can be licensed under any license, such as MIT, Apache, or even proprietary licenses), the CMS uses a **Hook and Provider Architecture**. 

By following these principles, a plugin interacts with the CMS through defined interfaces rather than "merging" with its internal logic.

---

## 2. Compliance Principles for Developers

To maintain separation and avoid the "Copyleft" clause, follow these structural rules:

### A. Use Defined Registration Interfaces
Only use the official `PluginDefinition` and `PluginManifest` interfaces to register your plugin.
- **DO**: Create a `src/index.tsx` that exports a `PluginDefinition`.
- **DO**: Use the `routes` and `sidebarItems` arrays to tell the CMS where your code lives.
- **WHY**: This is a "communication" mechanism. The CMS acts as a **Provider** (providing the router and sidebar), and your plugin acts as a **Consumer** of those slots.

### B. Namespacing and Separation
- **DO**: Keep all your plugin logic within your plugin directory (`src/plugins/{slug}/`).
- **DO**: Namespace your routes under `/plugins/{slug}/`.
- **DON'T**: Modify files in `src/components/`, `src/pages/`, or `api/` directly. 
- **WHY**: The CMS build system automatically gathers your plugin code without you having to touch the core "Original Work". Modifying core files directly creates a Derivative Work.

### C. Import Boundaries
The CMS provides shared infrastructure that is safe to import without triggering copyleft, as these are considered "functional requirements" for interoperability:
- **UI Components**: Importing from `@/components/ui/*` is permitted for visual consistency.
- **Hooks**: Using `@/contexts/AuthContext` or `@/hooks/use-toast.ts` is permitted to participate in the app's state.
- **Types**: Importing from `@/types/*` is required for interface compliance.

### D. API Integration
When adding backend functionality:
- **DO**: Use the `api/index.ts` entrypoint in your plugin.
- **DO**: Let the CMS mount your routes under `/api/plugins/{slug}/`.
- **WHY**: This uses the "Sidecar" pattern. Your API logic runs alongside the CMS but is logically distinct.

---

## 3. The "Hook and Provider" Pattern

The CMS follows the principle that **Interfaces are not subject to Copyleft**.

| Entity | Role | EUPL Role |
|---|---|---|
| **CMS Core** | **Provider** | Provides "Hooks" (empty slots like routes, sidebar, API mounting). |
| **Plugin** | **Implementation** | Fills those slots with specific logic. |

Because the Plugin does not require the *internal logic* of the CMS to function (it only requires the *shape* of the interfaces), it qualifies as a separate work under the "Interoperability" exceptions common in European copyright law and reinforced by the EUPL's spirit.

---

## 4. Summary: Required Workflow

1. **Keep it separate**: Never `git commit` your plugin code into the main CMS repository. Distribute it as a separate repository.
2. **Use the Registry**: The `scripts/install-plugins.mjs` script handles the build-time integration. This "assembly" step at build-time is an automated process and does not turn your plugin into a derivative work of the source code.
3. **Declare your License**: Even if your plugin is not EUPL, clearly state your chosen license in `plugin.json`.

---

## 5. Frequently Asked Questions

**Q: Can I sell a plugin for this CMS?**  
A: Yes. Because plugins are structured as separate works through the hook system, you are not forced to use the EUPL for your plugin, and you can apply commercial terms.

**Q: If I fix a bug in `src/components/ui/Button.tsx`, is that covered by EUPL?**  
A: **Yes.** Improving or modifying the core CMS code (Horizontal changes) creates a Derivative Work. You must contribute those changes back under the EUPL or maintain them under EUPL terms.

**Q: Does the build-time integration (Vite/TypeScript) matter?**  
A: No. The fact that the code is "bundled" together for the final browser bundle does not retroactively change the license of the source code. Copyright applies to the **Source Code** and the **Creative Expression**, not the minified production artifact.
