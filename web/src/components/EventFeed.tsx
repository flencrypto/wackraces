import { useQuery } from '@tanstack/react-query'
import { eventsApi, type Post } from '../lib/api'

interface EventFeedProps {
  eventId: string
}

function PostCard({ post }: { post: Post }) {
  return (
    <div style={{
      background: '#1e1e3a',
      borderRadius: '0.5rem',
      padding: '1rem',
      marginBottom: '0.75rem',
      border: '1px solid #2d2d4e'
    }}>
      {post.media.length > 0 && post.media[0].type.startsWith('image') && (
        <img src={post.media[0].url} alt="" style={{ width: '100%', borderRadius: '0.375rem', marginBottom: '0.5rem' }} />
      )}
      {post.caption && <p style={{ margin: 0, color: '#e2e8f0' }}>{post.caption}</p>}
      {post.city_label && <span style={{ color: '#64748b', fontSize: '0.75rem' }}>📍 {post.city_label}</span>}
      <div style={{ marginTop: '0.5rem', color: '#64748b', fontSize: '0.75rem' }}>
        {new Date(post.created_at).toLocaleString()}
      </div>
    </div>
  )
}

export default function EventFeed({ eventId }: EventFeedProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['feed', eventId],
    queryFn: () => eventsApi.getFeed(eventId),
    refetchInterval: 30_000,
  })

  if (isLoading) return <div style={{ padding: '1rem', color: '#64748b' }}>Loading feed…</div>
  if (error) return <div style={{ padding: '1rem', color: '#ef4444' }}>Failed to load feed</div>
  if (!data || data.posts.length === 0) return <div style={{ padding: '1rem', color: '#64748b' }}>No posts yet</div>

  return (
    <div style={{ padding: '0.5rem' }}>
      {data.posts.map(post => <PostCard key={post.id} post={post} />)}
    </div>
  )
}
