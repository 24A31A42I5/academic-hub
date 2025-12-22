import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Shield, ArrowLeft, Loader2 } from 'lucide-react';
import { z } from 'zod';
import { passwordSchema, emailSchema, fullNameSchema } from '@/lib/validation';

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

const studentSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  password: passwordSchema,
  rollNumber: z.string().min(1, 'Roll number is required'),
  year: z.string().min(1, 'Year is required'),
  branch: z.string().min(1, 'Branch is required'),
  section: z.string().min(1, 'Section is required'),
});

const facultySchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  password: passwordSchema,
  facultyId: z.string().min(1, 'Faculty ID is required'),
});

const adminSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  password: passwordSchema,
});

type Role = 'admin' | 'faculty' | 'student';

const branches = ['CSE', 'AIML', 'AI', 'DS', 'IT', 'ECE', 'EEE', 'MECH', 'CIVIL'];
const sections = ['A', 'B', 'C'];
const years = ['1', '2', '3', '4'];

const Auth = () => {
  const [searchParams] = useSearchParams();
  const isRegister = searchParams.get('mode') === 'register';
  const [mode, setMode] = useState<'login' | 'register'>(isRegister ? 'register' : 'login');
  const [role, setRole] = useState<Role>('student');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    fullName: '',
    rollNumber: '',
    year: '',
    branch: '',
    section: '',
    facultyId: '',
  });

  const { signIn, signUp, user, profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (!authLoading && user && profile) {
      navigateByRole(profile.role);
    }
  }, [user, profile, authLoading]);

  const navigateByRole = (userRole: string) => {
    switch (userRole) {
      case 'admin':
        navigate('/admin');
        break;
      case 'faculty':
        navigate('/faculty');
        break;
      case 'student':
        navigate('/student');
        break;
      default:
        navigate('/');
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: '' }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    try {
      if (mode === 'login') {
        const result = loginSchema.safeParse(formData);
        if (!result.success) {
          const newErrors: Record<string, string> = {};
          result.error.errors.forEach(err => {
            newErrors[err.path[0]] = err.message;
          });
          setErrors(newErrors);
          setLoading(false);
          return;
        }

        const { error } = await signIn(formData.email, formData.password);
        if (error) {
          toast({
            title: 'Login Failed',
            description: error.message === 'Invalid login credentials' 
              ? 'Invalid email or password. Please check your credentials.' 
              : error.message,
            variant: 'destructive',
          });
        } else {
          toast({ title: 'Welcome back!', description: 'Successfully logged in.' });
        }
      } else {
        let validationResult;
        if (role === 'student') {
          validationResult = studentSchema.safeParse(formData);
        } else if (role === 'faculty') {
          validationResult = facultySchema.safeParse(formData);
        } else {
          validationResult = adminSchema.safeParse(formData);
        }

        if (!validationResult.success) {
          const newErrors: Record<string, string> = {};
          validationResult.error.errors.forEach(err => {
            newErrors[err.path[0]] = err.message;
          });
          setErrors(newErrors);
          setLoading(false);
          return;
        }

        const additionalData = role === 'student' 
          ? { rollNumber: formData.rollNumber, year: parseInt(formData.year), branch: formData.branch, section: formData.section }
          : role === 'faculty' 
            ? { facultyId: formData.facultyId }
            : undefined;

        const { error } = await signUp(formData.email, formData.password, formData.fullName, role, additionalData);
        
        if (error) {
          if (error.message?.includes('already registered')) {
            toast({
              title: 'Account Exists',
              description: 'This email is already registered. Please sign in instead.',
              variant: 'destructive',
            });
          } else {
            toast({
              title: 'Registration Failed',
              description: error.message || 'An error occurred during registration.',
              variant: 'destructive',
            });
          }
        } else {
          toast({ title: 'Account Created!', description: 'Welcome to AcademiGuard.' });
        }
      }
    } catch (err) {
      toast({
        title: 'Error',
        description: 'An unexpected error occurred. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const roleColors = {
    admin: 'border-admin bg-admin-muted',
    faculty: 'border-faculty bg-faculty-muted',
    student: 'border-student bg-student-muted',
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary via-faculty to-student opacity-90" />
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4xIj48Y2lyY2xlIGN4PSIzMCIgY3k9IjMwIiByPSIyIi8+PC9nPjwvZz48L3N2Zz4=')] opacity-30" />
        <div className="relative z-10 flex flex-col items-center justify-center w-full p-12 text-primary-foreground">
          <div className="w-20 h-20 rounded-2xl bg-primary-foreground/20 backdrop-blur-sm flex items-center justify-center mb-8">
            <Shield className="w-12 h-12" />
          </div>
          <h1 className="text-4xl font-bold mb-4 text-center">AcademiGuard</h1>
          <p className="text-xl text-primary-foreground/80 text-center max-w-md">
            AI-Powered Academic Integrity Management System
          </p>
          <div className="mt-12 space-y-4 text-center">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-foreground/20 flex items-center justify-center">
                <span className="text-lg font-bold">1</span>
              </div>
              <span>Smart Fraud Detection</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-foreground/20 flex items-center justify-center">
                <span className="text-lg font-bold">2</span>
              </div>
              <span>Seamless Assignment Flow</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-foreground/20 flex items-center justify-center">
                <span className="text-lg font-bold">3</span>
              </div>
              <span>Real-time Analytics</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-8 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>

          <Card className="border-0 shadow-xl">
            <CardHeader className="text-center pb-4">
              <div className="lg:hidden w-12 h-12 mx-auto rounded-xl bg-gradient-to-br from-primary to-faculty flex items-center justify-center mb-4">
                <Shield className="w-7 h-7 text-primary-foreground" />
              </div>
              <CardTitle className="text-2xl">
                {mode === 'login' ? 'Welcome Back' : 'Create Account'}
              </CardTitle>
              <CardDescription>
                {mode === 'login' 
                  ? 'Sign in to access your dashboard' 
                  : 'Register to get started with AcademiGuard'}
              </CardDescription>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === 'register' && (
                  <>
                    {/* Role Selection */}
                    <div className="space-y-2">
                      <Label>Select Your Role</Label>
                      <div className="grid grid-cols-3 gap-2">
                        {(['admin', 'faculty', 'student'] as Role[]).map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setRole(r)}
                            className={`p-3 rounded-lg border-2 transition-all ${
                              role === r 
                                ? roleColors[r] + ' border-2' 
                                : 'border-border hover:border-muted-foreground/50'
                            }`}
                          >
                            <span className="capitalize font-medium">{r}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Full Name */}
                    <div className="space-y-2">
                      <Label htmlFor="fullName">Full Name</Label>
                      <Input
                        id="fullName"
                        value={formData.fullName}
                        onChange={(e) => handleInputChange('fullName', e.target.value)}
                        placeholder="Enter your full name"
                        className={errors.fullName ? 'border-destructive' : ''}
                      />
                      {errors.fullName && <p className="text-sm text-destructive">{errors.fullName}</p>}
                    </div>
                  </>
                )}

                {/* Email */}
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    placeholder="Enter your email"
                    className={errors.email ? 'border-destructive' : ''}
                  />
                  {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
                </div>

                {/* Password */}
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={formData.password}
                    onChange={(e) => handleInputChange('password', e.target.value)}
                    placeholder="Enter your password"
                    className={errors.password ? 'border-destructive' : ''}
                  />
                  {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
                </div>

                {/* Student Fields */}
                {mode === 'register' && role === 'student' && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="rollNumber">Roll Number</Label>
                      <Input
                        id="rollNumber"
                        value={formData.rollNumber}
                        onChange={(e) => handleInputChange('rollNumber', e.target.value)}
                        placeholder="Enter your roll number"
                        className={errors.rollNumber ? 'border-destructive' : ''}
                      />
                      {errors.rollNumber && <p className="text-sm text-destructive">{errors.rollNumber}</p>}
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-2">
                        <Label>Year</Label>
                        <Select value={formData.year} onValueChange={(v) => handleInputChange('year', v)}>
                          <SelectTrigger className={errors.year ? 'border-destructive' : ''}>
                            <SelectValue placeholder="Year" />
                          </SelectTrigger>
                          <SelectContent>
                            {years.map(y => (
                              <SelectItem key={y} value={y}>{y}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Branch</Label>
                        <Select value={formData.branch} onValueChange={(v) => handleInputChange('branch', v)}>
                          <SelectTrigger className={errors.branch ? 'border-destructive' : ''}>
                            <SelectValue placeholder="Branch" />
                          </SelectTrigger>
                          <SelectContent>
                            {branches.map(b => (
                              <SelectItem key={b} value={b}>{b}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Section</Label>
                        <Select value={formData.section} onValueChange={(v) => handleInputChange('section', v)}>
                          <SelectTrigger className={errors.section ? 'border-destructive' : ''}>
                            <SelectValue placeholder="Sec" />
                          </SelectTrigger>
                          <SelectContent>
                            {sections.map(s => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </>
                )}

                {/* Faculty Fields */}
                {mode === 'register' && role === 'faculty' && (
                  <div className="space-y-2">
                    <Label htmlFor="facultyId">Faculty ID</Label>
                    <Input
                      id="facultyId"
                      value={formData.facultyId}
                      onChange={(e) => handleInputChange('facultyId', e.target.value)}
                      placeholder="Enter your faculty ID"
                      className={errors.facultyId ? 'border-destructive' : ''}
                    />
                    {errors.facultyId && <p className="text-sm text-destructive">{errors.facultyId}</p>}
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  variant={role === 'admin' ? 'admin' : role === 'faculty' ? 'faculty' : 'student'}
                  size="lg"
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : mode === 'login' ? (
                    'Sign In'
                  ) : (
                    'Create Account'
                  )}
                </Button>

                <div className="text-center text-sm text-muted-foreground">
                  {mode === 'login' ? (
                    <>
                      Don't have an account?{' '}
                      <button
                        type="button"
                        onClick={() => setMode('register')}
                        className="text-primary hover:underline font-medium"
                      >
                        Sign Up
                      </button>
                    </>
                  ) : (
                    <>
                      Already have an account?{' '}
                      <button
                        type="button"
                        onClick={() => setMode('login')}
                        className="text-primary hover:underline font-medium"
                      >
                        Sign In
                      </button>
                    </>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Auth;
