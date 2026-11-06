export function ChatPickerChevron() {
  return (
    <svg className="workspace-page-chat-trigger-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="workspace-chat-chevron-metal" x1="6" y1="8" x2="18" y2="16" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f5fbff" />
          <stop offset="0.4" stopColor="#c2d8e5" />
          <stop offset="0.72" stopColor="#819aaa" />
          <stop offset="1" stopColor="#e0edf4" />
        </linearGradient>
      </defs>
      <path d="M6 8.8 12 15l6-6.2" fill="none" stroke="rgba(5, 11, 17, 0.86)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 8.8 12 15l6-6.2" fill="none" stroke="url(#workspace-chat-chevron-metal)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.4 8.4 12 14.2l5.6-5.8" fill="none" stroke="rgba(250, 253, 255, 0.5)" strokeWidth="0.65" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
