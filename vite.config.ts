import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages用: リポジトリ名をbaseに設定
  // ユーザーは自分のリポジトリ名に変更すること
  // 例: /mycalendar/ → https://username.github.io/mycalendar/
  base: '/mycalendar/',
})
