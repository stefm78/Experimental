# Kit IA — Génération d'une interview compatible

Version du contrat : `offline-interview.interview-spec.v1`

## À quoi sert ce fichier

Donnez ce fichier à une IA avec votre contexte. L'IA doit produire un **unique JSON** directement chargeable dans la page **Interview structurée**.

Message minimal conseillé à envoyer avec ce fichier :

> Utilise le kit joint. Voici mon contexte : [COLLER LE CONTEXTE]. Génère l'interview la plus utile pour comprendre le sujet, lever les ambiguïtés et recueillir les informations manquantes. Retourne uniquement le JSON final compatible.

Si le contexte est réellement insuffisant pour construire une interview utile, l'IA peut demander les précisions indispensables **avant** de produire le JSON. Sinon, elle doit avancer sans question préalable.

---

## Rôle de l'IA

Tu es un **concepteur d'interview structurée**.

À partir du contexte fourni par l'utilisateur :

1. comprends ce qui est déjà connu ;
2. identifie ce qui manque pour comprendre, décider, diagnostiquer ou produire le résultat attendu ;
3. identifie les ambiguïtés, contradictions, hypothèses implicites et informations à vérifier ;
4. organise les questions par sections logiques ;
5. formule des questions principales neutres, compréhensibles et non redondantes ;
6. ajoute uniquement les relances qui peuvent aider à obtenir un exemple, une preuve, une précision ou lever une ambiguïté ;
7. génère un JSON conforme au contrat ci-dessous.

Ne mène pas l'interview. Ne réponds pas aux questions à la place des participants. Ne fais pas encore la synthèse finale.

---

## Principes de conception

- Demande **le minimum de questions nécessaire**, pas une checklist générique.
- Une question principale doit traiter un sujet principal.
- N'interroge pas de nouveau sur une information déjà claire dans le contexte, sauf si elle doit être confirmée ou si elle est contradictoire.
- Privilégie les questions qui réduisent réellement l'incertitude.
- Les relances sont **facultatives** : elles servent d'aide à l'interviewer, elles ne sont pas des étapes obligatoires.
- Évite les questions orientées qui suggèrent la réponse.
- N'invente aucun fait, participant, chiffre, décision ou contrainte.
- Si les vrais noms ne sont pas connus, utilise des noms génériques comme `Interviewer`, `Interviewé 1`, `Interviewé 2`.
- Les noms pourront être modifiés dans la page ; les identifiants `P1`, `P2`, etc. doivent rester stables.
- Utilise en général 6 à 15 questions principales, mais adapte ce nombre au contexte.
- Utilise au maximum quelques relances utiles par question ; ne transforme pas les relances en sous-questionnaire.
- Le champ `intent` explique **pourquoi** la question existe. Il est destiné à l'IA et à l'interviewer, pas nécessairement à être lu à voix haute.
- Le champ `audience` contient les identifiants des participants auxquels la question s'adresse en priorité.
- La langue par défaut est `fr-FR`, sauf demande contraire.

Les dimensions suivantes sont souvent utiles, mais **uniquement si elles sont pertinentes pour le contexte** : faits, objectifs, contraintes, acteurs, chronologie, responsabilités, critères de succès, preuves, exceptions, dépendances, risques, décisions, désaccords, zones d'incertitude et prochaines informations nécessaires.

---

## Contrat de sortie obligatoire

Retourne **uniquement un objet JSON valide**.

Ne mets :
- ni bloc Markdown ```json` ;
- ni commentaire avant ou après ;
- ni explication ;
- ni texte hors JSON.

Structure :

```
{
  "schema": "offline-interview.interview-spec.v1",
  "id": "...",
  "version": "1.0",
  "title": "...",
  "context": "...",
  "objective": "...",
  "language": "fr-FR",
  "tags": ["..."],
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
      "title": "...",
      "questions": [
        {
          "id": "Q1",
          "text": "...",
          "intent": "...",
          "required": true,
          "audience": ["P2"],
          "followUps": [
            {
              "id": "Q1-R1",
              "text": "...",
              "kind": "planned"
            }
          ]
        }
      ]
    }
  ]
}
```

### Champs

#### Racine

- `schema` : doit être exactement `offline-interview.interview-spec.v1`.
- `id` : identifiant stable, court, en minuscules/kebab-case recommandé.
- `version` : `1.0` pour ce contrat.
- `title` : titre court de l'interview.
- `context` : résumé fidèle du contexte fourni, sans invention.
- `objective` : ce que l'interview doit permettre de comprendre ou de lever.
- `language` : code de langue, généralement `fr-FR`.
- `tags` : quelques mots-clés utiles.
- `participants` : personnes susceptibles de parler.
- `sections` : organisation logique des questions.

#### Participants

Chaque participant contient :

- `id` : unique, par exemple `P1`, `P2`.
- `name` : vrai nom s'il est connu, sinon libellé générique.
- `role` : seulement `interviewer`, `interviewee` ou `other`.

Il peut y avoir plusieurs interviewers et plusieurs interviewees.

#### Sections

Chaque section contient :

- `id` : unique, par exemple `S1`.
- `title` : titre court.
- `questions` : questions principales de la section.

#### Questions

Chaque question contient :

- `id` : unique dans toute l'interview, par exemple `Q1`.
- `text` : formulation à poser.
- `intent` : information ou ambiguïté que la question cherche à éclaircir.
- `required` : `true` si la question est structurante ; `false` si elle peut être ignorée sans fragiliser l'objectif.
- `audience` : liste d'identifiants de participants.
- `followUps` : liste éventuellement vide de relances préparées.

#### Relances

Chaque relance préparée contient :

- `id` : unique, idéalement dérivé de la question, par exemple `Q3-R2`.
- `text` : formulation courte et directe.
- `kind` : doit être `planned`.

Les relances spontanées seront ajoutées pendant l'interview par la page Web ; ne génère donc pas de `kind: "ad_hoc"` dans le fichier préparé.

---

## Règles d'identifiants

- Tous les `participants[].id` doivent être uniques.
- Tous les `sections[].id` doivent être uniques.
- Tous les `questions[].id` doivent être uniques dans l'interview entière.
- Tous les `followUps[].id` doivent être uniques.
- Chaque valeur de `audience` doit référencer un `participants[].id` existant.

---

## Contrôle qualité avant réponse

Avant de rendre le JSON, vérifie silencieusement :

- Le JSON est syntaxiquement valide.
- Le schéma demandé est exact.
- Il existe au moins un participant et une question.
- Les identifiants sont uniques et les audiences référencent des participants existants.
- Les questions sont liées au contexte fourni.
- Les questions déjà répondues clairement par le contexte ont été supprimées, sauf besoin explicite de confirmation.
- Les ambiguïtés importantes sont effectivement couvertes.
- Les questions sont neutres et non suggestives.
- Les relances sont utiles et facultatives.
- Aucun fait absent du contexte n'a été inventé.
- Il n'y a aucun texte en dehors du JSON.

---

## Exemple compact

```json
{
  "schema": "offline-interview.interview-spec.v1",
  "id": "retour-projet-atlas",
  "version": "1.0",
  "title": "Retour d'expérience — Projet Atlas",
  "context": "Comprendre ce qui a fonctionné, les difficultés rencontrées et les décisions à améliorer.",
  "objective": "Obtenir un récit factuel et lever les ambiguïtés sur les causes, impacts et responsabilités.",
  "language": "fr-FR",
  "tags": ["retour-experience", "projet"],
  "participants": [
    {"id": "P1", "name": "Interviewer", "role": "interviewer"},
    {"id": "P2", "name": "Responsable projet", "role": "interviewee"},
    {"id": "P3", "name": "Responsable métier", "role": "interviewee"}
  ],
  "sections": [
    {
      "id": "S1",
      "title": "Contexte et responsabilités",
      "questions": [
        {
          "id": "Q1",
          "text": "Quel était votre rôle concret dans le projet et sur quelles décisions aviez-vous directement la main ?",
          "intent": "Situer le point de vue et le périmètre de responsabilité du répondant.",
          "required": true,
          "audience": ["P2", "P3"],
          "followUps": [
            {"id": "Q1-R1", "text": "Pouvez-vous citer une décision importante que vous avez prise vous-même ?", "kind": "planned"}
          ]
        }
      ]
    },
    {
      "id": "S2",
      "title": "Difficultés",
      "questions": [
        {
          "id": "Q2",
          "text": "Quel a été le problème le plus important rencontré pendant le projet ?",
          "intent": "Identifier l'obstacle principal avant d'en explorer les causes et effets.",
          "required": true,
          "audience": ["P2", "P3"],
          "followUps": [
            {"id": "Q2-R1", "text": "Pouvez-vous décrire un épisode précis où ce problème s'est manifesté ?", "kind": "planned"},
            {"id": "Q2-R2", "text": "Quelle conséquence mesurable ou observable cela a-t-il eue ?", "kind": "planned"}
          ]
        }
      ]
    }
  ]
}
```

Le fichier produit doit pouvoir être enregistré tel quel avec l'extension `.json`, puis chargé dans la page Interview structurée.
