import { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  trend?: {
    value: number;
    label: string;
    positive?: boolean;
  };
  variant?: 'default' | 'admin' | 'faculty' | 'student' | 'warning';
  className?: string;
}

const variantStyles = {
  default: {
    iconBg: 'bg-primary/10',
    iconColor: 'text-primary',
  },
  admin: {
    iconBg: 'bg-admin-muted',
    iconColor: 'text-admin',
  },
  faculty: {
    iconBg: 'bg-faculty-muted',
    iconColor: 'text-faculty',
  },
  student: {
    iconBg: 'bg-student-muted',
    iconColor: 'text-student',
  },
  warning: {
    iconBg: 'bg-warning-muted',
    iconColor: 'text-warning',
  },
};

export const StatsCard = ({ title, value, icon, trend, variant = 'default', className }: StatsCardProps) => {
  const styles = variantStyles[variant];

  return (
    <Card className={cn('hover-lift transition-all duration-300', className)}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-sm text-muted-foreground mb-1">{title}</p>
            <p className="text-3xl font-bold">{value}</p>
            {trend && (
              <p className={cn('text-sm mt-2', trend.positive ? 'text-student' : 'text-destructive')}>
                {trend.positive ? '↑' : '↓'} {trend.value}% {trend.label}
              </p>
            )}
          </div>
          <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center', styles.iconBg)}>
            <div className={styles.iconColor}>{icon}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
