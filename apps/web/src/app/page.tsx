import { redirect } from 'next/navigation';

export default function Home() {
  // 访问根目录默认被安全引导到登录页或者 Dashboard
  redirect('/dashboard');
}
