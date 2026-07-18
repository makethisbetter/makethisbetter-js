export default {
  tab: 'Avis',
  toolbar: {
    markup: 'Annoter',
    record: 'Enregistrer',
    hint: "Cliquez sur un élément pour l'annoter · glissez pour dessiner",
    hintRecord: "Enregistrement de l'écran en cours",
    exit: 'Quitter',
  },
  popup: {
    about: 'À propos',
    placeholder: 'Décrivez le problème ou votre suggestion...',
    submit: 'Envoyer',
    cancel: 'Annuler',
    my_feedback: 'Mes avis',
    quickOptions: [
      { emoji: '🐛', label: 'Quelque chose ne fonctionne pas' },
      { emoji: '💡', label: "J'aimerais que cela fonctionne autrement" },
      { emoji: '🤔', label: 'Je ne comprends pas ceci' },
      { emoji: '✨', label: "J'ai une idée" },
    ],
  },
  success: {
    title: 'Merci !',
    message: 'Votre avis a bien été reçu.',
    title_no_ai: 'Envoyé !',
    message_no_ai: "On s'en occupe. Vous serez informé(e) dès que ce sera résolu.",
    view_feedback: 'Voir mes avis',
    close: 'Fermer',
    email_prompt: "Envie de suivre l'avancement ? Laissez votre e-mail et nous vous préviendrons une fois résolu.",
    email_placeholder: 'vous@exemple.com',
    email_submit: 'Me prévenir',
    email_saved: 'Vous recevrez un e-mail une fois résolu.',
    email_error: "Impossible d'enregistrer votre e-mail. Veuillez réessayer.",
  },
  error: {
    submit: "Échec de l'envoi. Veuillez réessayer.",
  },
  pet: {
    bubble: "Besoin d'aide ?",
  },
  frustration: {
    prompt: 'Un problème ? Dites-le-nous.',
    action: 'Annoter',
    dismiss: 'Fermer',
  },
  annotation: {
    drawing: 'Dessin',
    element: 'élément',
  },
  record: {
    stop: 'Arrêter',
    timer_label: 'Enregistrement',
    max_reached: "Durée maximale d'enregistrement atteinte",
  },
  clarify: {
    title: 'Make This Better AI',
    subtitle: 'Affinement de votre retour',
    thinking: 'Réflexion...',
    placeholder: 'Saisissez votre réponse — ou Ignorer',
    send: 'Envoyer',
    skip: 'Passer',
  },
}
