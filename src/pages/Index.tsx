import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Shield, GraduationCap, Users, Brain, CheckCircle, ArrowRight } from 'lucide-react';

const Index = () => {
  const features = [
    {
      icon: Shield,
      title: 'AI-Powered Fraud Detection',
      description: 'Advanced algorithms detect plagiarism, copied content, and handwriting fraud in real-time.'
    },
    {
      icon: GraduationCap,
      title: 'Role-Based Dashboards',
      description: 'Tailored experiences for administrators, faculty, and students with intuitive interfaces.'
    },
    {
      icon: Users,
      title: 'Section Management',
      description: 'Easily assign faculty to sections and manage student groups across departments.'
    },
    {
      icon: Brain,
      title: 'Smart Analytics',
      description: 'Comprehensive insights into academic performance and integrity metrics.'
    }
  ];

  const stats = [
    { value: '99.9%', label: 'Detection Accuracy' },
    { value: '50K+', label: 'Assignments Processed' },
    { value: '1000+', label: 'Institutions Trust Us' },
    { value: '24/7', label: 'Real-time Monitoring' }
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-faculty flex items-center justify-center">
              <Shield className="w-6 h-6 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold">AcademiGuard</span>
          </div>
          <nav className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-muted-foreground hover:text-foreground transition-colors">Features</a>
            <a href="#how-it-works" className="text-muted-foreground hover:text-foreground transition-colors">How It Works</a>
            <a href="#stats" className="text-muted-foreground hover:text-foreground transition-colors">Statistics</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link to="/auth">
              <Button variant="ghost">Sign In</Button>
            </Link>
            <Link to="/auth?mode=register">
              <Button variant="hero">Get Started</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-admin-muted via-background to-faculty-muted opacity-50" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-to-r from-primary/20 to-faculty/20 rounded-full blur-3xl" />
        
        <div className="container mx-auto relative z-10">
          <div className="max-w-4xl mx-auto text-center animate-fade-in">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary mb-6">
              <CheckCircle className="w-4 h-4" />
              <span className="text-sm font-medium">Trusted by 1000+ Institutions</span>
            </div>
            
            <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight">
              Academic Integrity
              <br />
              <span className="gradient-text">Redefined</span>
            </h1>
            
            <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
              Protect academic standards with AI-powered fraud detection. 
              Streamline assignments, submissions, and evaluations across your institution.
            </p>
            
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link to="/auth?mode=register">
                <Button variant="hero" size="xl" className="group">
                  Start Free Trial
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
              <Link to="/auth">
                <Button variant="outline" size="xl">
                  Sign In to Dashboard
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-4 bg-muted/30">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Powerful Features</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Everything you need to maintain academic integrity and streamline educational workflows.
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature, index) => (
              <div 
                key={feature.title}
                className="glass-card p-6 rounded-2xl hover-lift animate-slide-up"
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary to-faculty flex items-center justify-center mb-4">
                  <feature.icon className="w-7 h-7 text-primary-foreground" />
                </div>
                <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                <p className="text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section id="stats" className="py-20 px-4">
        <div className="container mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, index) => (
              <div 
                key={stat.label} 
                className="text-center animate-slide-up"
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <div className="text-4xl md:text-5xl font-bold gradient-text mb-2">{stat.value}</div>
                <div className="text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-20 px-4 bg-muted/30">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">How It Works</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Three simple roles, one powerful platform.
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <div className="glass-card p-8 rounded-2xl text-center hover-lift">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-admin flex items-center justify-center mb-6">
                <Users className="w-8 h-8 text-admin-foreground" />
              </div>
              <h3 className="text-2xl font-semibold mb-3 text-admin">Admin</h3>
              <p className="text-muted-foreground">
                Manage faculty, students, and sections. Monitor system-wide analytics and fraud detection reports.
              </p>
            </div>
            
            <div className="glass-card p-8 rounded-2xl text-center hover-lift">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-faculty flex items-center justify-center mb-6">
                <GraduationCap className="w-8 h-8 text-faculty-foreground" />
              </div>
              <h3 className="text-2xl font-semibold mb-3 text-faculty">Faculty</h3>
              <p className="text-muted-foreground">
                Create assignments, review AI-flagged submissions, and provide feedback with smart grading tools.
              </p>
            </div>
            
            <div className="glass-card p-8 rounded-2xl text-center hover-lift">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-student flex items-center justify-center mb-6">
                <Brain className="w-8 h-8 text-student-foreground" />
              </div>
              <h3 className="text-2xl font-semibold mb-3 text-student">Student</h3>
              <p className="text-muted-foreground">
                Submit assignments, track deadlines, and view feedback and grades in a clean, intuitive interface.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto">
          <div className="max-w-4xl mx-auto text-center glass-card p-12 rounded-3xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-faculty/10" />
            <div className="relative z-10">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to Get Started?</h2>
              <p className="text-muted-foreground text-lg mb-8 max-w-xl mx-auto">
                Join thousands of institutions protecting academic integrity with AI-powered solutions.
              </p>
              <Link to="/auth?mode=register">
                <Button variant="hero" size="xl">
                  Create Your Account
                  <ArrowRight className="w-5 h-5" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-4 border-t border-border">
        <div className="container mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-faculty flex items-center justify-center">
              <Shield className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-semibold">AcademiGuard</span>
          </div>
          <p className="text-muted-foreground text-sm">
            © 2024 AcademiGuard. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
