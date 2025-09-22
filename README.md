diff --git a/README.md b/README.md
index 7059a962adb0138b65dd10e0aee66ccfe984b8c6..7e7e4504f8e7082b72d989cadc9dfa8e702de93c 100644
--- a/README.md
+++ b/README.md
@@ -1,12 +1,47 @@
-# React + Vite
+# Intégration Monday embarquée
 
-This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.
+Cette application React illustre comment embarquer une vue personnalisée dans Monday.com. Elle récupère le contexte fourni par l'iframe (board, item, workspace) puis charge, via l'API GraphQL de Monday, un aperçu de la planche courante.
 
-Currently, two official plugins are available:
+## Prérequis
 
-- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
-- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh
+- Node.js 18 ou supérieur
+- Un compte Monday.com avec les droits pour créer une application personnalisée
+- Une clé d'API (token personnel ou token OAuth) autorisant l'accès en lecture au board que vous souhaitez afficher
 
-## Expanding the ESLint configuration
+## Installation
 
-If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
+1. Installez les dépendances :
+
+   ```bash
+   npm install
+   ```
+
+2. Configurez votre application Monday pour charger l'URL fournie par Vite (ou votre déploiement) dans un widget/iframe. C'est Monday qui transmettra automatiquement le contexte et un token temporaire au SDK lorsque l'application sera exécutée dans l'iframe.
+
+## Développement local
+
+1. Lancez le serveur de développement :
+
+   ```bash
+   npm run dev
+   ```
+
+2. Ouvrez l'URL affichée par Vite. Lorsqu'elle est intégrée dans Monday, l'application reçoit automatiquement le contexte via le SDK Monday (`monday-sdk-js`). En mode local hors Monday, le contexte restera vide et l'écran affichera "Chargement du contexte…".
+
+## Tests
+
+L'application s'appuie sur Vitest et React Testing Library pour couvrir les principaux scénarios (chargement, récupération du contexte, rafraîchissement des items lorsque Monday signale un changement).
+
+```bash
+npm test
+```
+
+## Déploiement
+
+Le dépôt contient un fichier `vercel.json` permettant de déployer l'application sur Vercel. Veillez à restreindre le domaine autorisé dans Monday pour l'URL que vous déployez (afin que l'iframe puisse charger l'application).
+
+## Structure principale
+
+- `src/App.jsx` : composant principal qui écoute le contexte Monday et interroge l'API GraphQL.
+- `src/App.test.jsx` : tests unitaires couvrant les différents états de l'application.
+- `vite.config.js` : configuration Vite + Vitest.
