import React from 'react'
import { bustCropStyle } from '../lib/agent-avatar-meta'

type AgentCustomImageProps = {
  src: string
  aspect: number
  headBox: { x: number; y: number; w: number; h: number }
  size?: number
  busy?: boolean
  onError?: () => void
}

const BUST_MAX_SIZE = 130

const AgentCustomImage: React.FC<AgentCustomImageProps> = ({ src, aspect, headBox, size = 40, busy, onError }) => {
  const radius = size <= 28 ? 8 : size <= 40 ? 10 : 12

  return (
    <span
      className={`agent-custom-figure${busy ? ' agent-custom-figure--busy' : ''}`}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        overflow: 'hidden',
        display: 'inline-block',
        background: 'var(--bg-secondary, #f1f5f9)',
        lineHeight: 0,
      }}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        onError={onError}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
        }}
      />
    </span>
  )
}

export default AgentCustomImage
