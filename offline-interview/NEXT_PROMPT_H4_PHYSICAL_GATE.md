# Best next prompt — Offline Interview H4 physical gate

Reprends Offline Interview depuis la preuve terrain H3 et l'état Git courant.

1. Revalide le control plane et le HEAD/CAS avant toute mutation.
2. Considère la capture physique H3 comme autorité d'observation : Q02 affiche `error=11` puis Android déclenche un ANR `00 Offline Interview Native ne répond pas`.
3. Ne confonds pas observation et causalité : `ERROR_SERVER_DISCONNECTED (11)` + ANR sont prouvés ; le blocage du pipe STT est une hypothèse issue du code.
4. Préserve impérativement l'architecture audio qualifiée : un seul AudioRecord autoritaire, WAV maître continu, STT remplaçable, routage par identité de session, human_lock prioritaire.
5. Qualifie H4 uniquement si le chemin AudioRecord -> WAV ne contient aucun write bloquant vers STT et si le feeder STT est borné/disposable.
6. Autorise au plus un retry borné pour les erreurs provider transitoires 7/8/11, sans interrompre le WAV et sans bloquer le thread UI.
7. Exécute CI et build Android. Ne fournis aucun APK si les gates automatisés ne sont pas PASS.
8. Si CI est PASS, récupère l'APK exacte H4, donne son identité et demande un test physique cinq questions sans pause artificielle.
9. PASS physique H4 exige : identité 0.4.3-h4-tactical / runtime v4.3, 5/5 si parole fournie à chaque question, aucun ANR, WAV continu pcmBytes>0, aucune migration inter-question, et toute erreur 11 soit absente soit récupérée par un unique attempt supplémentaire.
10. Ne merge ni H3 ni H4 tant que ce gate physique n'est pas satisfait.

Retourne : OBSERVATION_H3 / HYPOTHESIS / H4_REPAIR / CI / APK / PHYSICAL_GATE / NEXT_DECISION.
