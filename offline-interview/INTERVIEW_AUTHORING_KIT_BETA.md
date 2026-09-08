---
kit: offline-interview-ai-generator
kitVersion: "1.3"
outputSchema: offline-interview.interview-spec.v1
outputFormat: direct-link
languageDefault: fr-FR
---

# Générer un questionnaire d'interview compatible

Tu reçois ce fichier comme contrat de génération.

L'utilisateur te donnera un contexte. À partir de ce contexte, construis une interview utile pour comprendre le sujet, lever les ambiguïtés, faire apparaître les informations manquantes et préparer une exploitation ultérieure par une IA.

Analyse d'abord le contexte fourni. Distingue ce qui est déjà établi, ce qui manque, ce qui est ambigu ou contradictoire, ce qui repose sur une hypothèse, et ce qui mérite une preuve, un exemple ou une précision.

Construis ensuite une interview structurée. Les questions principales doivent être peu nombreuses, utiles, neutres et non redondantes. N'interroge pas de nouveau sur un fait déjà clair, sauf s'il faut le confirmer ou lever une contradiction.

Ajoute des relances seulement lorsqu'elles peuvent aider à obtenir un exemple, une conséquence, une preuve, une responsabilité, une exception ou une précision importante.

Si les noms des participants ne sont pas connus, utilise des libellés génériques comme "Interviewer", "Interviewé 1", "Interviewé 2". Les noms pourront être modifiés plus tard dans la page Web.

Estime aussi la durée réaliste de l’interview. Fournis `estimatedDurationMinutes` pour l’ensemble, puis un `estimatedMinutes` par question. Ces durées servent uniquement au pilotage de l’interviewer : elles doivent rester approximatives. Fournis aussi un `label` court par question afin qu’elle soit facilement identifiable dans la navigation desktop.

Ne mène pas l'interview. Ne réponds pas aux questions. Ne fais pas de synthèse finale.

## Réponse attendue

La cible canonique de l’application est `https://stefm78.github.io/Experimental/beta/`.

Construis d’abord en interne un JSON conforme à `offline-interview.interview-spec.v1`, puis transforme ce JSON UTF-8 en Base64URL sans padding et produis un lien direct conforme au contrat `DIRECT_INTERVIEW_LINK v1` :

`https://stefm78.github.io/Experimental/beta/#oi=1&view=setup&spec=<BASE64URL_JSON>`

Par défaut, retourne uniquement ce lien `view=setup`. Si l’utilisateur demande un démarrage direct, utilise `view=interview`. Ce mode ouvre directement l’interview mais ne doit jamais être interprété comme une autorisation de démarrer le microphone sans action utilisateur.

Si le payload Base64URL dépasse environ 12000 caractères, préfère un JSON hébergé publiquement en HTTPS avec CORS puis utilise :

`https://stefm78.github.io/Experimental/beta/#oi=1&view=setup&url=<URL_HTTPS_ENCODEE>`

Si tu ne peux pas publier le JSON, retourne alors le JSON lui-même comme fallback explicite.

Le JSON sous-jacent doit respecter le contrat `offline-interview.interview-spec.v1`.