# H7 autonomous continuation prompt

Reprends Offline Interview depuis la preuve physique composite H6, PR #94 et l'état Git courant.

## Governance / bootstrap

1. Revalide le bootstrap constitutionnel UCP exact avant toute nouvelle session gouvernée.
2. Revalide `CONTROL_PLANE_HEAD.json` puis l'identité UAO reachable depuis ce HEAD.
3. Avant toute mutation/promotion, revalide HEAD/CAS et l'identité exacte de la branche/PR cible.
4. Ne merge/promote rien sans gate physique lorsqu'un gate physique reste matériel.

## Authority

La preuve téléphone est l'autorité du gate physique.

H6 prouve simultanément :
- master audio stable et 5/5 questions complétées ;
- zéro erreur provider 5/8/11 et zéro retry ;
- zéro final et zéro segment sur 5/5 ;
- cinq timeouts EOF + fallback partiel ;
- 53 chunks STT perdus sur Q01 seulement ;
- télémétrie partielle H6 non exploitable à cause d'un overflow du sentinel `Long.MIN_VALUE`.

L'historique du repository prouve aussi que V1 utilisait explicitement :

`RecognizerIntent.EXTRA_SEGMENTED_SESSION = RecognizerIntent.EXTRA_AUDIO_SOURCE`

et que son test physique avait produit des résultats `segment`.

Les successeurs V3/H4/H5/H6 ont conservé `EXTRA_AUDIO_SOURCE` mais perdu ce flag. Traite cela comme une régression sémantique concrète avant de conclure que `SpeechRecognizer` doit être abandonné.

## H7 mission

Construis et qualifie un successeur H7 minimal et isolé qui :

- préserve strictement le single `AudioRecord` et le WAV maître continu ;
- préserve le feeder STT jetable et non bloquant pour le thread de capture ;
- préserve le routage par identité de session et une session recognizer par question ;
- préserve la finalisation par EOF sans `stopListening()` et le cooldown provider ;
- restaure exactement `EXTRA_SEGMENTED_SESSION = EXTRA_AUDIO_SOURCE` ;
- augmente de façon bornée la queue PCM STT pour absorber le backlog Q01, sans jamais ralentir le WAV maître ;
- expose `queueHighWaterMark`, capacités de queue et pertes PCM ;
- corrige la télémétrie partielle afin que le premier événement ne soit plus éliminé par overflow arithmétique ;
- conserve `human_lock > provider final > provider segment > partial snapshot` ;
- ne modifie pas les décisions web/beta non liées.

## Kernel initiative

Tu as la capacité de prendre l'initiative dans les limites suivantes :

- si CI révèle un défaut mécanique local, corrige-le automatiquement et relance ;
- si l'audit trouve une régression antérieure directement liée au gate, corrige-la sans demander confirmation, tant que l'autorité produit/audio ne change pas ;
- si un réglage borné est nécessaire pour éviter une perte de preuve (taille de queue, télémétrie, timeout raisonnable), choisis-le et documente-le ;
- ne multiplie pas les variantes H7.x pour des hypothèses spéculatives ;
- si le futur run H7 échoue encore avec zéro résultat durable et aucune nouvelle régression concrète, prononce `FAIL_STRATEGY` et pivote vers le fallback embedded ASR déjà prévu dans le README, plutôt que d'empiler de nouveaux délais/retries SpeechRecognizer ;
- dans ce pivot, conserve le single capture/WAV comme architecture souveraine et remplace uniquement le provider STT.

## Automated gate before device

Exige sur le même HEAD :
- productization tests PASS ;
- runtime validation PASS ;
- Android compilation/build PASS ;
- test statique prouvant la présence du flag segmented ;
- test statique prouvant l'absence de `stopListening()` dans la finalisation ;
- test statique prouvant qu'aucun `sink.write()` ne revient dans le thread capture ;
- test de télémétrie empêchant le retour du sentinel overflow ;
- identité build/runtime distincte et exportée.

Si les gates automatisés passent, récupère l'APK exacte et n'attends qu'un seul nouveau geste humain :

**faire normalement les cinq questions une fois, puis exporter le JSON.**

## Composite physical verdict

À partir de ce seul JSON, décide automatiquement :

### PASS_SYSTEM_STT_SEGMENTED
si :
- 5/5 ;
- WAV maître sain ;
- pas d'ANR ;
- pertes STT nulles ou non matérielles ;
- absence de régression provider 5/8/11 ;
- résultats provider `segment` ou `final` durables sur une fraction significative des questions ;
- routage inter-question correct.

### HOLD
uniquement s'il existe une amélioration matérielle et un défaut restant concret, borné et causalement exploitable.

### FAIL_STRATEGY
si le mode segmented restauré reste incapable de produire des résultats durables de façon exploitable, ou si le provider reste structurellement impropre au produit sans nouvelle régression locale à corriger.

En cas de `FAIL_STRATEGY`, ne lance aucun H8 de timing/retry. Construis directement une décision d'architecture et un POC embedded-ASR minimal contre le WAV maître existant, en réutilisant autant que possible les laboratoires Whisper/ASR déjà présents dans le repository, mais sans réintroduire la voie browser instable dans le produit Android.

Retourne : preuve H6, décision causale, changements H7, état CI, PR, APK exacte, protocole physique unique et critère de pivot automatique.
