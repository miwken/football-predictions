import Link from 'next/link';

export default function Home() {
  return (
    <div>
      <div>Список матчей (будет позже)</div>
      <div className="p-4">
        <Link href="/tournaments" className="text-blue-500 underline">
          Мои турниры
        </Link>
      </div>
    </div>
  );
}