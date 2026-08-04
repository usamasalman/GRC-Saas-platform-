import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  sub: string;
  trend?: string; // 'up', 'down', or 'neutral'
  variant?: string; // 'good', 'warn', 'danger'
}

const StatCard: React.FC<StatCardProps> = ({ label, value, sub, trend, variant }) => {
  return (
    <div className={`stat-card stat-${variant || 'default'}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-val">{value}</div>
      <div className="stat-sub">
        {trend && <span className={`trend ${trend}`}></span>}
        {sub}
      </div>
    </div>
  );
};

export default StatCard;
