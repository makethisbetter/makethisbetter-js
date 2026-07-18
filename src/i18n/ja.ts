export default {
  tab: 'フィードバック',
  toolbar: {
    markup: 'マークアップ',
    record: '録画',
    hint: '要素をクリックして注釈 · ドラッグで描画',
    hintRecord: '画面を録画中',
    exit: '終了',
  },
  popup: {
    about: '概要',
    placeholder: '問題や提案を入力してください...',
    submit: '送信',
    cancel: 'キャンセル',
    my_feedback: '自分のフィードバック',
    quickOptions: [
      { emoji: '🐛', label: '不具合があります' },
      { emoji: '💡', label: 'もっと使いやすくしてほしい' },
      { emoji: '🤔', label: 'ここがわかりにくい' },
      { emoji: '✨', label: 'アイデアがあります' },
    ],
  },
  success: {
    title: 'ありがとうございます！',
    message: 'フィードバックを受け付けました。',
    title_no_ai: '送信しました！',
    message_no_ai: 'チームが対応します。解決次第お知らせします。',
    view_feedback: 'フィードバックを確認',
    close: '閉じる',
    email_prompt: '進捗を知りたい場合は、メールアドレスをご記入ください。解決次第お知らせします。',
    email_placeholder: 'you@example.com',
    email_submit: '通知を受け取る',
    email_saved: '解決次第メールでお知らせします。',
    email_error: 'メールアドレスを保存できませんでした。もう一度お試しください。',
  },
  error: {
    submit: '送信に失敗しました。もう一度お試しください。',
  },
  pet: {
    bubble: 'お困りですか？',
  },
  frustration: {
    prompt: 'うまくいかないことがありますか？お知らせください。',
    action: '注釈',
    dismiss: '閉じる',
  },
  annotation: {
    drawing: '描画',
    element: '要素',
  },
  record: {
    stop: '停止',
    timer_label: '録画中',
    max_reached: '最大録画時間に達しました',
  },
  clarify: {
    title: 'Make This Better AI',
    subtitle: 'フィードバックを整えています',
    thinking: '考え中...',
    placeholder: '回答を入力 — またはスキップ',
    send: '送信',
    skip: 'スキップ',
  },
}
