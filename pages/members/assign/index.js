import { useEffect } from 'react';
import { useRouter } from 'next/router';

// 阵容分配：复用现有 /main 分配工具
export default function AssignPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/main');
  }, [router]);
  return <div className="empty" style={{ padding: '90px 0' }}>正在打开阵容分配工具…</div>;
}
