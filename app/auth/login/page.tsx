"use client";

import { supabase } from '@/lib/supabaseClient';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();

  const handleSignUp = async () => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) alert(error.message);
    else alert('Проверьте почту для подтверждения');
  };

  const handleSignIn = async () => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) alert(error.message);
    else router.push('/');
  };

  return (
    <div className="p-4 max-w-sm mx-auto">
      <h1 className="text-xl font-bold mb-4">Вход / Регистрация</h1>
      <input className="border p-2 w-full mb-2" placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
      <input className="border p-2 w-full mb-2" placeholder="Пароль" type="password" value={password} onChange={e => setPassword(e.target.value)} />
      <div className="flex gap-2">
        <button onClick={handleSignIn} className="bg-blue-500 text-white p-2 rounded">Войти</button>
        <button onClick={handleSignUp} className="bg-green-500 text-white p-2 rounded">Зарегистрироваться</button>
      </div>
    </div>
  );
}