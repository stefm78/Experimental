# Interview Spec v1

Le runtime charge un JSON `offline-interview.interview-spec.v1` et exporte un JSON `offline-interview.interview-result.v1`.

## Principes

- le fichier d'entrée décrit **quoi demander**, pas les réponses ;
- les participants ont un `id` stable, un `name` modifiable et un `role` ;
- l'interview est structurée en `sections`, puis `questions` ;
- une question peut avoir une `intent`, une `audience` et des `followUps` facultatives ;
- les relances prévues sont des suggestions, jamais des étapes obligatoires ;
- pendant l'entretien, les réponses sont stockées comme une suite de `turns` attribuées à un `speakerId` ;
- l'audio n'est pas exporté ni persisté.

## Format minimal d'entrée

```json
{
  "schema": "offline-interview.interview-spec.v1",
  "id": "project-discovery-v1",
  "version": "1.0",
  "title": "Découverte projet",
  "context": "Contexte métier libre.",
  "objective": "Lever les ambiguïtés avant décision.",
  "language": "fr-FR",
  "participants": [
    {"id": "P1", "name": "Interviewer", "role": "interviewer"},
    {"id": "P2", "name": "Interviewé", "role": "interviewee"}
  ],
  "sections": [
    {
      "id": "S1",
      "title": "Contexte",
      "questions": [
        {
          "id": "Q1",
          "text": "Quel problème cherchez-vous à résoudre ?",
          "intent": "Comprendre le besoin réel.",
          "required": true,
          "audience": ["P2"],
          "followUps": [
            {"id": "Q1-R1", "text": "Pouvez-vous donner un exemple concret ?", "kind": "planned"}
          ]
        }
      ]
    }
  ]
}
```

## Rôles de participants

Les rôles reconnus par l'UI sont `interviewer`, `interviewee` et `other`. Le runtime reste tolérant : un rôle inconnu est ramené à `other`.

## Compatibilité

Le runtime accepte aussi l'ancien format plat `{ id, version, title, questions: [...] }` et le normalise en mémoire vers `interview-spec.v1`.

## Sortie destinée à une IA

L'export JSON contient :

- la métadonnée de l'interview ;
- le snapshot des participants ;
- la session et son niveau de complétude ;
- chaque section et question d'origine ;
- les relances planifiées ;
- les `turns` dans l'ordre, avec `speakerId`, nom/rôle résolus, type (`answer` ou `follow_up`), source (`speech` ou `keyboard`), texte final et, si disponible, transcription brute.

Le texte peut donc être exploité sans perdre la provenance conversationnelle.
