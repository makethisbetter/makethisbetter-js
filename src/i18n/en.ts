export default {
  tab: 'Feedback',
  toolbar: {
    markup: 'Mark up',
    record: 'Record',
    hint: 'Click any element to annotate · drag to draw',
    hintRecord: 'Recording your screen',
    exit: 'Exit',
  },
  popup: {
    about: 'About',
    placeholder: 'Describe the issue or suggestion...',
    submit: 'Submit',
    cancel: 'Cancel',
    my_feedback: 'My feedback',
    quickOptions: [
      { emoji: '🐛', label: 'Something is broken' },
      { emoji: '💡', label: 'I wish this worked differently' },
      { emoji: '🤔', label: "I don't understand this" },
      { emoji: '✨', label: 'I have an idea' },
    ],
  },
  success: {
    title: 'Thanks!',
    message: 'Your feedback has been received.',
    title_no_ai: 'Sent — thanks!',
    message_no_ai: "We'll take it from here. You'll hear back when it's resolved.",
    view_feedback: 'View my feedback',
    close: 'Close',
    email_prompt: "Want updates? Leave your email and we'll let you know when it's resolved.",
    email_placeholder: 'you@example.com',
    email_submit: 'Notify me',
    email_saved: "You'll get an email when it's resolved.",
    email_error: "Couldn't save your email. Please try again.",
  },
  error: {
    submit: 'Failed to submit. Please try again.',
  },
  pet: {
    bubble: 'Need help?',
  },
  frustration: {
    prompt: 'Something not working? Tell us.',
    action: 'Annotate',
    dismiss: 'Dismiss',
  },
  annotation: {
    drawing: 'Drawing',
    element: 'element',
  },
  record: {
    stop: 'Stop',
    timer_label: 'Recording',
    max_reached: 'Maximum recording time reached',
  },
  clarify: {
    title: 'Make This Better AI',
    subtitle: 'Sharpening your feedback',
    thinking: 'Thinking...',
    placeholder: 'Type your answer — or Skip',
    send: 'Send',
    skip: 'Skip',
  },
}
