import Head from 'next/head';
import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function HomePage() {
  const router = useRouter();

  // useEffect(() => {
  //   // 重定向到登录页面
  //   router.push('/login');
  // }, [router]);
  useEffect(() => {
    // 重定向到主页
    router.push('/main');
  }, []);

  return null;
}