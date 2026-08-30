# Experimental

## Offline Interview POC

Prototype d'interview vocale **local-first**, déployé comme GitHub Page.

### Objectif

Valider qu'une page Web/PWA peut :

1. embarquer un questionnaire en français ;
2. enregistrer une réponse au microphone ;
3. transcrire la réponse localement avec Whisper dans le navigateur ;
4. conserver uniquement le texte dans IndexedDB ;
5. reprendre une session interrompue ;
6. exporter l'entretien en TXT et JSON ;
7. continuer après la préparation initiale en mode hors connexion.

### Architecture du POC

- UI statique : `offline-interview/`
- STT : Transformers.js `4.2.0` + `onnx-community/whisper-tiny`, quantification `q4`, backend WASM
- stockage : IndexedDB + demande de stockage persistant quand disponible
- offline : service worker pour le shell et les dépendances runtime ; cache navigateur Transformers.js pour le modèle et ONNX Runtime
- déploiement : GitHub Actions vers GitHub Pages
- audio : conservé uniquement en mémoire pendant la transcription, puis relâché ; pas d'enregistrement audio persistant dans le POC

### Test d'acceptation manuel

1. Ouvrir la GitHub Page avec une connexion réseau.
2. Cliquer **Préparer le mode hors ligne** et attendre `Moteur STT : Prêt hors ligne`.
3. Répondre à Q1 et valider.
4. Activer le mode avion.
5. Fermer complètement l'onglet/la PWA.
6. Rouvrir l'application hors connexion.
7. Reprendre à Q2 et transcrire une nouvelle réponse.
8. Fermer pendant Q3 puis rouvrir : Q1/Q2 doivent être conservées et la reprise proposée.
9. Terminer l'entretien et exporter TXT + JSON.

### Limites connues du spike

- Whisper Tiny q4 privilégie le poids et la compatibilité ; sa précision française doit être mesurée avant industrialisation.
- Le premier chargement du modèle est volumineux et nécessite une connexion.
- Le stockage persistant reste soumis à la politique du navigateur.
- GitHub Pages ne fournit pas d'en-têtes COOP/COEP personnalisés : le POC force donc ONNX/WASM à un thread pour éviter de dépendre de `SharedArrayBuffer`.
- La conservation de l'audio n'est pas implémentée par choix de minimisation des données.

### Décision attendue après POC

Mesurer sur au moins un Android et un PC : temps de préparation, temps de transcription, précision française, reprise hors ligne et robustesse après fermeture. Ensuite seulement décider s'il faut passer à Whisper Base, WebGPU, ou extraire une brique STT réutilisable.
