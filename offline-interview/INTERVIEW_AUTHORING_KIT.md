---
kit: offline-interview-ai-generator
kitVersion: "1.2"
outputSchema: offline-interview.interview-spec.v1
outputFormat: json
languageDefault: fr-FR
---

# Générer un questionnaire d'interview compatible

Tu reçois ce fichier comme contrat de génération.

L'utilisateur te donnera un contexte. À partir de ce contexte, construis une interview utile pour comprendre le sujet, lever les ambiguïtés, faire apparaître les informations manquantes et préparer une exploitation ultérieure par une IA.

## Ce que tu dois faire

Analyse d'abord le contexte fourni. Distingue ce qui est déjà établi, ce qui manque, ce qui est ambigu ou contradictoire, ce qui repose sur une hypothèse, et ce qui mérite une preuve, un exemple ou une précision.

Construis ensuite une interview structurée. Les questions principales doivent être peu nombreuses, utiles, neutres et non redondantes. N'interroge pas de nouveau sur un fait déjà clair, sauf s'il faut le confirmer ou lever une contradiction.

Ajoute des relances seulement lorsqu'elles peuvent aider à obtenir un exemple, une conséquence, une preuve, une responsabilité, une exception ou une précision importante.

Si les noms des participants ne sont pas connus, utilise des libellés génériques comme "Interviewer", "Interviewé 1", "Interviewé 2". Les noms pourront être modifiés plus tard dans la page Web.

Estime aussi la durée réaliste de l’interview. Fournis `estimatedDurationMinutes` pour l’ensemble, puis un `estimatedMinutes` par question. Ces durées servent uniquement au pilotage de l’interviewer : elles doivent rester approximatives. Fournis aussi un `label` court par question afin qu’elle soit facilement identifiable dans la navigation desktop.

Ne mène pas l'interview. Ne réponds pas aux questions. Ne fais pas de synthèse finale.

## Réponse attendue

Retourne uniquement le JSON final, sans Markdown, sans explication avant ou après.

Le JSON doit respecter le contrat `offline-interview.interview-spec.v1`.

Règles essentielles :
- `schema` vaut exactement `offline-interview.interview-spec.v1` ;
- `version` vaut `1.0` ;
- les rôles autorisés sont `interviewer`, `interviewee`, `other` ;
- les identifiants participants, sections, questions et relances sont uniques ;
- chaque `audience` référence uniquement des participants existants ;
- les relances générées ont toujours `kind: "planned"` ;
- aucune donnée absente du contexte ne doit être inventée ;
- vise en général 6 à 15 questions principales, mais adapte la longueur au besoin réel ;
- fournis un `label` court et distinct pour chaque question ;
- fournis `estimatedDurationMinutes` et `estimatedMinutes` avec des valeurs réalistes et approximatives.

## Forme du document à produire

```json
{
  "schema": "offline-interview.interview-spec.v1",
  "id": "identifiant-court",
  "version": "1.0",
  "title": "Titre de l'interview",
  "context": "Résumé fidèle du contexte fourni",
  "objective": "Ce que l'interview doit permettre de comprendre ou de lever",
  "language": "fr-FR",
  "tags": ["mot-cle"],
  "estimatedDurationMinutes": 30,
  "participants": [
    {
      "id": "P1",
      "name": "Interviewer",
      "role": "interviewer"
    },
    {
      "id": "P2",
      "name": "Interviewé 1",
      "role": "interviewee"
    }
  ],
  "sections": [
    {
      "id": "S1",
      "title": "Titre de section",
      "questions": [
        {
          "id": "Q1",
          "label": "Besoin principal",
          "text": "Question à poser",
          "intent": "Pourquoi cette question existe et quelle incertitude elle doit réduire",
          "required": true,
          "estimatedMinutes": 4,
          "audience": ["P2"],
          "followUps": [
            {
              "id": "Q1-R1",
              "text": "Relance facultative",
              "kind": "planned"
            }
          ]
        }
      ]
    }
  ]
}
```

## Contrat machine embarqué

Si une instruction textuelle ci-dessus semble entrer en conflit avec ce schéma, ce schéma est la référence structurelle.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "offline-interview.interview-spec.v1",
  "title": "Offline Interview Spec v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema", "id", "version", "title", "context", "objective", "language", "tags", "participants", "sections"],
  "properties": {
    "schema": {"const": "offline-interview.interview-spec.v1"},
    "id": {"type": "string", "minLength": 1},
    "version": {"const": "1.0"},
    "title": {"type": "string", "minLength": 1},
    "context": {"type": "string"},
    "objective": {"type": "string", "minLength": 1},
    "language": {"type": "string", "minLength": 2},
    "tags": {"type": "array", "items": {"type": "string", "minLength": 1}, "uniqueItems": true},
    "estimatedDurationMinutes": {"type": "number", "exclusiveMinimum": 0},
    "participants": {"type": "array", "minItems": 1, "items": {"$ref": "#/$defs/participant"}},
    "sections": {"type": "array", "minItems": 1, "items": {"$ref": "#/$defs/section"}}
  },
  "$defs": {
    "participant": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "name", "role"],
      "properties": {
        "id": {"type": "string", "minLength": 1},
        "name": {"type": "string", "minLength": 1},
        "role": {"enum": ["interviewer", "interviewee", "other"]}
      }
    },
    "section": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "title", "questions"],
      "properties": {
        "id": {"type": "string", "minLength": 1},
        "title": {"type": "string", "minLength": 1},
        "questions": {"type": "array", "minItems": 1, "items": {"$ref": "#/$defs/question"}}
      }
    },
    "question": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "text", "intent", "required", "audience", "followUps"],
      "properties": {
        "id": {"type": "string", "minLength": 1},
        "label": {"type": "string", "minLength": 1},
        "text": {"type": "string", "minLength": 1},
        "intent": {"type": "string", "minLength": 1},
        "required": {"type": "boolean"},
        "estimatedMinutes": {"type": "number", "exclusiveMinimum": 0},
        "audience": {"type": "array", "items": {"type": "string", "minLength": 1}, "uniqueItems": true},
        "followUps": {"type": "array", "items": {"$ref": "#/$defs/followUp"}}
      }
    },
    "followUp": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "text", "kind"],
      "properties": {
        "id": {"type": "string", "minLength": 1},
        "text": {"type": "string", "minLength": 1},
        "kind": {"const": "planned"}
      }
    }
  }
}
```

## Contrôle silencieux avant de répondre

Avant de rendre le JSON :
- vérifie qu'il est syntaxiquement valide ;
- vérifie les identifiants et les références d'audience ;
- supprime les questions inutiles ou déjà clairement répondues par le contexte ;
- vérifie que les ambiguïtés importantes sont couvertes ;
- vérifie que les questions ne suggèrent pas leur réponse ;
- vérifie que les relances restent facultatives ;
- vérifie que rien n'a été inventé.

Ensuite, retourne uniquement le JSON final.
