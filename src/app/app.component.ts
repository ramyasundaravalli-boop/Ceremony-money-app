import { Component, OnInit, OnDestroy } from '@angular/core';
import { 
  Firestore, 
  collection, 
  addDoc, 
  collectionData,
  query,
  where,
  doc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  enableIndexedDbPersistence
} from '@angular/fire/firestore';
import { 
  Auth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  ConfirmationResult,
  signOut,
  onAuthStateChanged,
  updateProfile
} from '@angular/fire/auth';
import { BehaviorSubject, Subscription, fromEvent, merge, timer } from 'rxjs';
import { map, startWith, debounceTime, switchMap } from 'rxjs/operators';

// ==================== INTERFACES ====================
interface User {
  uid: string;
  email?: string;
  phone?: string;
  displayName: string;
  createdAt: Date;
  isAdmin?: boolean;
  adminSince?: Date;
}

interface Event {
  id?: string;
  name: string;
  type: string;
  date: string;
  location: string;
  targetAmount: number;
  createdAt: Date;
  userId: string;
  _localId?: string;
  _pendingSync?: boolean;
}

interface Participant {
  id?: string;
  eventId: string;
  name: string;
  phone: string;
  email?: string;
  place: string;
  userId: string;
  _localId?: string;
  _pendingSync?: boolean;
}

interface Contribution {
  id?: string;
  eventId: string;
  participantId: string;
  participantName?: string;
  participantPhone?: string;
  participantPlace?: string;
  amount: number;
  paymentMethod: 'cash' | 'digital' | 'bank';
  date: Date;
  notes?: string;
  userId: string;
  _localId?: string;
  _pendingSync?: boolean;
}

interface SMSTemplate {
  id?: string;
  name: string;
  message: string;
  eventId?: string;
  userId: string;
}

interface SyncStatus {
  online: boolean;
  lastSync: Date | null;
  pendingChanges: number;
  syncing: boolean;
}

interface AdminStats {
  totalUsers: number;
  totalEvents: number;
  totalParticipants: number;
  totalContributions: number;
  totalMoneyCollected: number;
  recentActivity: any[];
}

// ==================== COMPONENT ====================
@Component({
  selector: 'app-root',
  template: `
    <div class="container">
      <!-- Authentication View -->
      <div *ngIf="currentView === 'auth'" class="auth-container">
        <div class="auth-card">
          <!-- OTP Input Step -->
          <div *ngIf="authStep === 'input'" class="otp-step">
            <h2>🔐 உள்நுழைக</h2>
            <p class="auth-subtitle">
              உங்கள் தொலைபேசி எண் அல்லது மின்னஞ்சலை உள்ளிட்டு OTP பெறவும்
            </p>
            
            <div class="auth-form">
              <div class="form-group">
                <input 
                  type="text" 
                  [(ngModel)]="authData.phoneOrEmail" 
                  placeholder="தொலைபேசி எண் அல்லது மின்னஞ்சலை உள்ளிடவும்" 
                  class="form-input"
                  (keyup.enter)="requestOTP()">
              </div>

              <div class="form-group">
                <input 
                  type="text" 
                  [(ngModel)]="authData.displayName" 
                  placeholder="உங்கள் பெயரை உள்ளிடவும் (விருப்பம்)" 
                  class="form-input">
              </div>

              <div *ngIf="authData.phoneOrEmail" class="otp-method-indicator">
                <small>
                  OTP அனுப்பப்படும்: 
                  <strong>
                    {{ authData.phoneOrEmail.includes('@') ? 'மின்னஞ்சல் மூலம்' : 'SMS மூலம்' }}
                  </strong>
                </small>
              </div>
              
              <button (click)="requestOTP()" class="btn btn-primary btn-large">
                📱 OTP அனுப்பவும்
              </button>
            </div>
          </div>

          <!-- OTP Verification Step -->
          <div *ngIf="authStep === 'otp'" class="otp-step">
            <h2>✅ OTP சரிபார்க்கவும்</h2>
            <p class="auth-subtitle">
              OTP அனுப்பப்பட்டது: 
              <strong>{{authData.phoneOrEmail}}</strong>
              ({{authData.otpMethod === 'sms' ? 'SMS மூலம்' : 'மின்னஞ்சல் மூலம்'}})
            </p>
            
            <div class="auth-form">
              <div class="form-group">
                <input 
                  type="text" 
                  [(ngModel)]="authData.otp" 
                  placeholder="6-இலக்க OTP உள்ளிடவும்" 
                  class="form-input otp-input"
                  maxlength="6"
                  (keyup.enter)="verifyOTP()">
              </div>

              <div *ngIf="!authData.displayName" class="form-group">
                <input 
                  type="text" 
                  [(ngModel)]="authData.displayName" 
                  placeholder="உங்கள் பெயரை உள்ளிடவும் (விருப்பம்)" 
                  class="form-input">
              </div>

              <div *ngIf="otpCountdown > 0" class="otp-timer">
                <small>
                  விநாடிகளில் மீண்டும் அனுப்பவும் {{otpCountdown}}
                </small>
              </div>

              <div *ngIf="canResendOTP" class="resend-otp">
                <p class="auth-switch">
                  OTP பெறவில்லையா?
                  <a (click)="resendOTP()" class="auth-link">
                    OTP மீண்டும் அனுப்பவும்
                  </a>
                </p>
              </div>
              
              <div class="otp-actions">
                <button (click)="backToInput()" class="btn btn-secondary">
                  ↩️ திரும்பு
                </button>
                <button (click)="verifyOTP()" class="btn btn-primary">
                  ✅ OTP சரிபார்க்கவும்
                </button>
              </div>
            </div>
          </div>

          <div id="recaptcha-container"></div>
        </div>
      </div>

      <!-- Dashboard View -->
      <div *ngIf="currentView === 'dashboard'" class="dashboard-container">
        <header class="dashboard-header">
          <div class="header-content">
            <div class="header-info">
              <h1>🎉 விழா பணத் தொகுப்பு</h1>
              <p>மீண்டும் வரவேற்கிறோம்! உங்கள் விழா நிதிகளை நிர்வகிக்கவும்</p>
            </div>
            
            <div class="online-status-section">
              <div class="sync-status" [class.syncing]="syncStatus.syncing" [class.offline]="!syncStatus.online">
                <div class="sync-indicator">
                  <span class="sync-dot" [class.online]="syncStatus.online" [class.syncing]="syncStatus.syncing"></span>
                  {{ syncStatus.online ? (syncStatus.syncing ? '🔄' : '🟢') : '🔴' }}
                  <span class="sync-text">
                    {{ syncStatus.online ? 
                       (syncStatus.syncing ? 'ஒத்திவைக்கிறது...' : 'ஆன்லைன்') : 
                       'ஆஃப்லைன்' 
                    }}
                  </span>
                </div>
                
                <div *ngIf="syncStatus.pendingChanges > 0" class="pending-changes">
                  <span class="pending-badge">{{ syncStatus.pendingChanges }}</span>
                  <span class="pending-text">நிலுவை மாற்றங்கள்</span>
                </div>
                
                <div class="sync-actions">
                  <button *ngIf="syncStatus.pendingChanges > 0 && syncStatus.online" 
                          (click)="manualSync()" 
                          class="btn btn-sync"
                          [disabled]="syncStatus.syncing">
                    🔄 ஒத்திவை
                  </button>
                  
                  <button (click)="toggleOfflineMode()" class="btn btn-offline-toggle">
                    {{ syncStatus.online ? '📴' : '📱' }}
                    {{ syncStatus.online ? 'ஆஃப்லைனில் செல்லவும்' : 'ஆன்லைனில் செல்லவும்' }}
                  </button>
                </div>
              </div>
              
              <div class="admin-actions" *ngIf="isAdminUser">
                <button (click)="goToAdminPanel()" class="btn btn-admin">
                  👑 நிர்வாக குழு
                </button>
              </div>
              
              <div class="user-section">
                <span class="user-email">{{ user?.email || user?.phone }}</span>
                <span *ngIf="isAdminUser" class="admin-badge">👑 நிர்வாகி</span>
                <button (click)="logout()" class="btn btn-outline">வெளியேறு</button>
              </div>
            </div>
          </div>
        </header>

        <div *ngIf="!syncStatus.online" class="offline-banner">
          <div class="offline-banner-content">
            <span class="offline-icon">🔴</span>
            <span class="offline-message">
              ஆஃப்லைனில் வேலை செய்கிறது. 
              <span *ngIf="syncStatus.pendingChanges > 0">
                {{ syncStatus.pendingChanges }} நிலுவை மாற்றங்கள்.
              </span>
            </span>
            <button (click)="manualSync()" class="btn btn-small btn-outline" [disabled]="!syncStatus.online">
              🔄 ஒத்திவை
            </button>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-icon">📊</div>
            <div class="stat-info">
              <h3>{{ dashboardStats.eventsCount || 0 }}</h3>
              <p>மொத்த விழாக்கள்</p>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">💰</div>
            <div class="stat-info">
              <h3>₹{{ dashboardStats.totalCollected || 0 }}</h3>
              <p>மொத்த தொகை</p>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">👥</div>
            <div class="stat-info">
              <h3>{{ events.length }}</h3>
              <p>செயலில் உள்ள விழாக்கள்</p>
            </div>
          </div>
        </div>

        <div class="section card">
          <h2>📅 புதிய விழாவை உருவாக்கவும்</h2>
          <div class="form-group">
            <input [(ngModel)]="newEvent.name" placeholder="விழா பெயர் (எ.கா: திருமணம்)" class="form-input">
            <input [(ngModel)]="newEvent.type" placeholder="விழா வகை" class="form-input">
            <input [(ngModel)]="newEvent.date" type="date" class="form-input">
            <input [(ngModel)]="newEvent.location" placeholder="இடம்" class="form-input">
            <input [(ngModel)]="newEvent.targetAmount" type="number" placeholder="இலக்கு தொகை" class="form-input">
            <button (click)="createEvent()" class="btn btn-primary">விழாவை உருவாக்கவும்</button>
          </div>
        </div>

        <div class="section card">
          <h2>📋 உங்கள் விழாக்கள் ({{events.length}})</h2>
          <div *ngIf="events.length === 0" class="empty-state">
            <p>இன்னும் விழாக்கள் உருவாக்கப்படவில்லை. முதல் விழாவை மேலே உருவாக்கவும்!</p>
          </div>
          <div *ngFor="let event of events" class="event-card">
            <div class="event-info">
              <h3>{{event.name}}</h3>
              <p><strong>வகை:</strong> {{event.type}}</p>
              <p><strong>தேதி:</strong> {{event.date}}</p>
              <p><strong>இடம்:</strong> {{event.location}}</p>
              <p><strong>இலக்கு:</strong> ₹{{event.targetAmount}}</p>
            </div>
            <button (click)="selectEvent(event)" class="btn btn-secondary">
              விழாவை நிர்வகிக்கவும்
            </button>
          </div>
        </div>

        <div *ngIf="selectedEvent" class="section card">
          <h2>💰 நிர்வகிக்கிறது: {{selectedEvent.name}}</h2>
          
          <div class="pdf-actions">
            <button (click)="downloadEventReport()" class="btn btn-pdf" [disabled]="!selectedEvent">
              📊 விழா அறிக்கை
            </button>
            <button (click)="downloadParticipantList()" class="btn btn-pdf" [disabled]="participants.length === 0">
              👥 பங்கேற்பாளர் பட்டியல்
            </button>
            <button (click)="downloadContributionReport()" class="btn btn-pdf" [disabled]="contributions.length === 0">
              💰 பங்களிப்பு அறிக்கை
            </button>
          </div>
          
          <div class="progress-section">
            <h3>தொகுப்பு முன்னேற்றம்</h3>
            <div class="progress-bar">
              <div class="progress-fill" [style.width.%]="getProgressPercentage()"></div>
            </div>
            <p class="progress-text">
              ₹{{getTotalCollected()}} / ₹{{selectedEvent.targetAmount}} 
              ({{getProgressPercentage().toFixed(1)}}%)
            </p>
            <p class="progress-text">
              <strong>திரட்டப்பட்டது:</strong> ₹{{getTotalCollected()}} | 
              <strong>மீதம்:</strong> ₹{{getRemainingAmount()}}
            </p>
          </div>

          <div class="management-section">
            <h3>👥 பங்கேற்பாளரைச் சேர்க்கவும்</h3>
            <div class="form-group">
              <input [(ngModel)]="newParticipant.name" placeholder="முழு பெயர்" class="form-input">
              <input [(ngModel)]="newParticipant.phone" placeholder="தொலைபேசி எண்" class="form-input">
              <input [(ngModel)]="newParticipant.email" placeholder="மின்னஞ்சல் (விருப்பம்)" class="form-input">
              <input [(ngModel)]="newParticipant.place" placeholder="பங்கேற்பாளரின் இடம்" class="form-input">
              <button (click)="addParticipant()" class="btn btn-primary">பங்கேற்பாளரைச் சேர்க்கவும்</button>
            </div>
          </div>

          <div class="management-section">
            <h3>💵 பங்களிப்பைப் பதிவு செய்யவும்</h3>
            <div class="form-group">
              <select [(ngModel)]="newContribution.participantId" class="form-input">
                <option value="">பங்கேற்பாளரைத் தேர்ந்தெடுக்கவும்</option>
                <option *ngFor="let participant of participants" [value]="participant.id">
                  {{participant.name}} ({{participant.phone}})
                </option>
              </select>
              <input [(ngModel)]="newContribution.amount" type="number" placeholder="தொகை" class="form-input">
              <select [(ngModel)]="newContribution.paymentMethod" class="form-input">
                <option value="cash">💵 ரொக்கம்</option>
                <option value="digital">📱 டிஜிட்டல்</option>
                <option value="bank">🏦 வங்கி</option>
              </select>
              <input [(ngModel)]="newContribution.notes" placeholder="குறிப்புகள் (விருப்பம்)" class="form-input">
              <button (click)="addContribution()" class="btn btn-primary">பங்களிப்பைப் பதிவு செய்யவும்</button>
            </div>
          </div>

          <div class="management-section">
            <h3>பங்கேற்பாளர்கள் ({{participants.length}})</h3>
            <div *ngIf="participants.length === 0" class="empty-state">
              <p>இன்னும் பங்கேற்பாளர்கள் சேர்க்கப்படவில்லை</p>
            </div>
            <div *ngFor="let participant of participants" class="participant-item">
              <div class="participant-info">
                <div class="participant-name">{{participant.name}}</div>
                <div class="participant-details">
                  <span>📞 {{participant.phone}}</span>
                  <span *ngIf="participant.email"> | 📧 {{participant.email}}</span>
                  <span *ngIf="participant.place"> | 📍 {{participant.place}}</span>
                </div>
              </div>
              <div class="participant-actions">
                <button (click)="sendWelcomeSMS(participant)" class="btn btn-xs btn-primary">👋</button>
                <button (click)="sendThanksSMS(participant)" class="btn btn-xs btn-success">🙏</button>
              </div>
            </div>
          </div>

          <div class="management-section">
            <h3>சமீபத்திய பங்களிப்புகள் ({{contributions.length}})</h3>
            <div *ngIf="contributions.length === 0" class="empty-state">
              <p>இன்னும் பங்களிப்புகள் பதிவு செய்யப்படவில்லை</p>
            </div>
            <div *ngFor="let contribution of contributions" class="contribution-item">
              <div class="contribution-details">
                <strong>{{contribution.participantName}}</strong>
                <span class="contribution-amount">₹{{contribution.amount}}</span>
              </div>
              <div class="contribution-meta">
                <span class="payment-method">{{ 
                  contribution.paymentMethod === 'cash' ? 'ரொக்கம்' :
                  contribution.paymentMethod === 'digital' ? 'டிஜிட்டல்' : 'வங்கி'
                }}</span>
                <small>{{contribution.date | date:'medium'}}</small>
              </div>
            </div>
          </div>

          <div class="management-section">
            <h3>📱 SMS டெம்ப்ளேட்டுகள்</h3>
            
            <div class="sms-template-form">
              <h4>SMS டெம்ப்ளேட்டை உருவாக்கவும்</h4>
              <div class="form-group">
                <input [(ngModel)]="newSmsTemplate.name" placeholder="டெம்ப்ளேட் பெயர்" class="form-input">
                <textarea [(ngModel)]="newSmsTemplate.message" placeholder="செய்தி" class="form-input" rows="3"></textarea>
                <button (click)="createSmsTemplate()" class="btn btn-primary">டெம்ப்ளேட்டை உருவாக்கவும்</button>
              </div>
            </div>

            <div class="templates-list">
              <div *ngIf="smsTemplates.length === 0" class="empty-state">
                <p>இன்னும் SMS டெம்ப்ளேட்டுகள் இல்லை</p>
              </div>
              <div *ngFor="let template of smsTemplates" class="template-item">
                <strong>{{template.name}}</strong>
                <p>{{template.message}}</p>
              </div>
            </div>

            <div class="sms-actions">
              <button (click)="openSmsModal()" class="btn btn-primary">
                📱 SMS அனுப்பவும்
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Admin Panel View -->
      <div *ngIf="currentView === 'admin'" class="admin-container">
        <div class="admin-header">
          <div class="admin-header-content">
            <h1>👑 நிர்வாக டாஷ்போர்டு</h1>
            <button (click)="goToDashboard()" class="btn btn-secondary">
              ↩️ டாஷ்போர்டிற்குத் திரும்பு
            </button>
          </div>
        </div>

        <div class="section card">
          <h2>📊 கணினி கண்ணோட்டம்</h2>
          <div class="admin-stats-grid">
            <div class="admin-stat-card">
              <div class="admin-stat-icon">👥</div>
              <div class="admin-stat-info">
                <h3>{{adminStats.totalUsers}}</h3>
                <p>மொத்த பயனர்கள்</p>
              </div>
            </div>
            <div class="admin-stat-card">
              <div class="admin-stat-icon">🎉</div>
              <div class="admin-stat-info">
                <h3>{{adminStats.totalEvents}}</h3>
                <p>மொத்த விழாக்கள்</p>
              </div>
            </div>
            <div class="admin-stat-card">
              <div class="admin-stat-icon">👤</div>
              <div class="admin-stat-info">
                <h3>{{adminStats.totalParticipants}}</h3>
                <p>மொத்த பங்கேற்பாளர்கள்</p>
              </div>
            </div>
            <div class="admin-stat-card">
              <div class="admin-stat-icon">💰</div>
              <div class="admin-stat-info">
                <h3>{{adminStats.totalContributions}}</h3>
                <p>மொத்த பங்களிப்புகள்</p>
              </div>
            </div>
            <div class="admin-stat-card">
              <div class="admin-stat-icon">💵</div>
              <div class="admin-stat-info">
                <h3>₹{{adminStats.totalMoneyCollected}}</h3>
                <p>மொத்த தொகை</p>
              </div>
            </div>
          </div>

          <div class="admin-pdf-actions">
            <button (click)="downloadAdminReport()" class="btn btn-primary">
              📄 நிர்வாக அறிக்கை
            </button>
          </div>
        </div>

        <div class="section card">
          <h2>👥 பயனர் நிர்வாகம்</h2>
          <div class="admin-table-container">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>பெயர்</th>
                  <th>மின்னஞ்சல்/தொலைபேசி</th>
                  <th>பதிவு தேதி</th>
                  <th>நிர்வாகி</th>
                  <th>செயல்கள்</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let user of allUsers">
                  <td>
                    <strong>{{user.displayName}}</strong>
                    <span *ngIf="user.uid === this.user?.uid" class="current-user-badge">(நீங்கள்)</span>
                  </td>
                  <td>{{user.email || user.phone}}</td>
                  <td>{{user.createdAt | date:'medium'}}</td>
                  <td>
                    <span class="admin-status" [class.is-admin]="user.isAdmin">
                      {{user.isAdmin ? '👑 ஆம்' : 'இல்லை'}}
                    </span>
                  </td>
                  <td class="action-buttons">
                    <button (click)="viewUserData(user)" class="btn btn-small btn-info">
                      👁️ காண்க
                    </button>
                    <button *ngIf="!user.isAdmin" (click)="makeUserAdmin(user)" class="btn btn-small btn-warning">
                      👑 நிர்வாகியாக்கு
                    </button>
                    <button *ngIf="user.isAdmin && user.uid !== this.user?.uid" 
                            (click)="removeUserAdmin(user)" class="btn btn-small btn-danger">
                      🚫 நீக்கு
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div *ngIf="selectedUser" class="section card">
          <div class="user-details-header">
            <h2>👤 பயனர் விவரங்கள்: {{selectedUser.displayName}}</h2>
            <button (click)="selectedUser = null" class="btn btn-secondary">
              ↩️ திரும்பு
            </button>
          </div>

          <div class="management-section">
            <h3>🎉 விழாக்கள் ({{userEvents.length}})</h3>
            <div *ngIf="userEvents.length === 0" class="empty-state">
              <p>விழாக்கள் இல்லை</p>
            </div>
            <div *ngFor="let event of userEvents" class="event-card">
              <div class="event-info">
                <h4>{{event.name}}</h4>
                <p><strong>வகை:</strong> {{event.type}}</p>
                <p><strong>தேதி:</strong> {{event.date}}</p>
                <p><strong>இலக்கு:</strong> ₹{{event.targetAmount}}</p>
              </div>
            </div>
          </div>

          <div class="management-section">
            <h3>👥 பங்கேற்பாளர்கள் ({{userParticipants.length}})</h3>
            <div *ngIf="userParticipants.length === 0" class="empty-state">
              <p>பங்கேற்பாளர்கள் இல்லை</p>
            </div>
            <div *ngFor="let participant of userParticipants" class="participant-item">
              <strong>{{participant.name}}</strong> - {{participant.phone}}
              <span *ngIf="participant.place">({{participant.place}})</span>
            </div>
          </div>

          <div class="management-section">
            <h3>💰 பங்களிப்புகள் ({{userContributions.length}})</h3>
            <div *ngIf="userContributions.length === 0" class="empty-state">
              <p>பங்களிப்புகள் இல்லை</p>
            </div>
            <div *ngFor="let contribution of userContributions" class="contribution-item">
              <div class="contribution-details">
                <strong>{{contribution.participantName}}</strong>
                <span class="contribution-amount">₹{{contribution.amount}}</span>
              </div>
              <div class="contribution-meta">
                <span class="payment-method">{{contribution.paymentMethod}}</span>
                <small>{{contribution.date | date:'medium'}}</small>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- SMS Modal -->
      <div *ngIf="showSmsModal" class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header">
            <h3>📱 பங்கேற்பாளர்களுக்கு SMS அனுப்பவும்</h3>
            <button (click)="closeSmsModal()" class="btn-close">&times;</button>
          </div>
          
          <div class="modal-body">
            <div class="form-group">
              <label>டெம்ப்ளேட்டைத் தேர்ந்தெடுக்கவும்</label>
              <select [(ngModel)]="selectedSmsTemplate" (change)="onTemplateSelect()" class="form-input">
                <option value="">தனிப்பயன் செய்தி</option>
                <option *ngFor="let template of smsTemplates" [value]="template.id">
                  {{template.name}}
                </option>
              </select>
            </div>

            <div class="form-group">
              <label>செய்தி</label>
              <textarea [(ngModel)]="customSmsMessage" class="form-input" rows="4" 
                        placeholder="உங்கள் SMS செய்தியை இங்கே உள்ளிடவும்..."></textarea>
            </div>

            <div class="form-group">
              <label>பெறுநர்கள்</label>
              <select [(ngModel)]="smsRecipients" class="form-input">
                <option value="all">அனைத்து பங்கேற்பாளர்களும்</option>
                <option value="selected">தேர்ந்தெடுக்கப்பட்ட பங்கேற்பாளர்கள்</option>
                <option value="contributors">பங்களிப்பாளர்கள் மட்டும்</option>
              </select>
            </div>

            <div *ngIf="smsRecipients === 'selected'" class="participant-selection">
              <div class="selection-actions">
                <button (click)="selectAllParticipants()" class="btn btn-small">அனைத்தையும் தேர்ந்தெடுக்கவும்</button>
                <button (click)="deselectAllParticipants()" class="btn btn-small">அனைத்தையும் நீக்கவும்</button>
              </div>
              <div class="participant-checkboxes">
                <div *ngFor="let participant of participants" class="checkbox-item">
                  <label>
                    <input type="checkbox" 
                           [checked]="selectedParticipantsForSms.includes(participant.id!)"
                           (change)="toggleParticipantSelection(participant.id!)">
                    {{participant.name}} - {{participant.phone}} ({{participant.place}})
                  </label>
                </div>
              </div>
            </div>

            <div class="variables-info">
              <h4>பயன்படுத்தக்கூடிய மாறிகள்:</h4>
              <code>{{name}}, {{eventName}}, {{eventDate}}, {{eventLocation}}, {{place}}, {{amount}}</code>
            </div>
          </div>

          <div class="modal-footer">
            <button (click)="closeSmsModal()" class="btn btn-secondary">ரத்து செய்க</button>
            <button (click)="sendBulkSMS()" class="btn btn-primary">SMS அனுப்பவும்</button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    /* Global Styles */
    * { box-sizing: border-box; }
    body { margin: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5; color: #333; }
    .container { min-height: 100vh; }

    /* Authentication Styles */
    .auth-container { display: flex; justify-content: center; align-items: center; min-height: 100vh; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; }
    .auth-card { background: white; padding: 40px; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); width: 100%; max-width: 400px; text-align: center; }
    .auth-card h2 { margin-bottom: 10px; color: #333; font-size: 1.8em; }
    .auth-subtitle { color: #666; margin-bottom: 30px; font-size: 0.95em; }
    .auth-form .form-group { margin-bottom: 20px; }
    .form-input { width: 100%; padding: 12px 15px; border: 1px solid #ddd; border-radius: 8px; font-size: 16px; transition: border-color 0.3s ease; }
    .form-input:focus { outline: none; border-color: #4CAF50; box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.1); }
    .btn { padding: 12px 20px; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: 500; transition: all 0.3s ease; }
    .btn-primary { background-color: #4CAF50; color: white; }
    .btn-primary:hover { background-color: #45a049; transform: translateY(-1px); }
    .btn-secondary { background-color: #2196F3; color: white; }
    .btn-secondary:hover { background-color: #1976D2; transform: translateY(-1px); }
    .btn-outline { background: transparent; border: 2px solid white; color: white; }
    .btn-outline:hover { background: white; color: #667eea; }
    .btn-large { width: 100%; padding: 15px; font-size: 16px; margin-bottom: 20px; }
    .auth-switch { color: #666; margin: 0; font-size: 0.9em; }
    .auth-link { color: #4CAF50; cursor: pointer; text-decoration: none; font-weight: 500; }
    .auth-link:hover { color: #45a049; text-decoration: underline; }

    /* OTP Styles */
    .otp-method-indicator { margin: 10px 0; padding: 10px; background: #e3f2fd; border-radius: 5px; border-left: 3px solid #2196F3; }
    .otp-method-indicator small { color: #1976d2; font-weight: 500; }
    .otp-input { text-align: center; font-size: 18px; font-weight: bold; letter-spacing: 8px; }
    .otp-timer { margin: 15px 0; padding: 10px; background: #fff3e0; border-radius: 5px; border: 1px solid #ffb74d; }
    .otp-timer small { color: #f57c00; font-weight: 500; }
    .resend-otp { margin: 15px 0; }
    .otp-actions { display: flex; gap: 10px; margin-top: 20px; }
    .otp-actions .btn { flex: 1; }

    /* Dashboard Styles */
    .dashboard-container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    .dashboard-header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px 0; margin: -20px -20px 30px -20px; border-radius: 0 0 15px 15px; }
    .header-content { max-width: 1200px; margin: 0 auto; padding: 0 20px; display: flex; justify-content: space-between; align-items: center; }
    .header-info h1 { margin: 0; font-size: 2.2em; }
    .header-info p { margin: 5px 0 0 0; opacity: 0.9; }

    /* Online Status */
    .online-status-section { display: flex; align-items: center; gap: 20px; }
    .sync-status { display: flex; align-items: center; gap: 15px; padding: 10px 15px; background: rgba(255, 255, 255, 0.1); border-radius: 25px; backdrop-filter: blur(10px); }
    .sync-indicator { display: flex; align-items: center; gap: 8px; font-size: 0.9em; font-weight: 500; }
    .sync-dot { width: 8px; height: 8px; border-radius: 50%; background: #4CAF50; }
    .sync-dot.online { background: #4CAF50; }
    .sync-dot.syncing { background: #FF9800; animation: pulse 1.5s infinite; }
    .sync-status.offline .sync-dot { background: #f44336; }
    .sync-text { color: white; }
    .pending-changes { display: flex; align-items: center; gap: 5px; background: rgba(255, 193, 7, 0.2); padding: 4px 8px; border-radius: 12px; }
    .pending-badge { background: #FFC107; color: #333; border-radius: 50%; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; font-size: 0.7em; font-weight: bold; }
    .pending-text { color: #FFC107; font-size: 0.8em; }
    .sync-actions { display: flex; gap: 8px; }
    .btn-sync { background: rgba(76, 175, 80, 0.2); color: white; border: 1px solid rgba(76, 175, 80, 0.5); padding: 6px 12px; border-radius: 15px; font-size: 0.8em; }
    .btn-sync:hover:not(:disabled) { background: rgba(76, 175, 80, 0.4); }
    .btn-offline-toggle { background: rgba(33, 150, 243, 0.2); color: white; border: 1px solid rgba(33, 150, 243, 0.5); padding: 6px 12px; border-radius: 15px; font-size: 0.8em; }
    .btn-offline-toggle:hover { background: rgba(33, 150, 243, 0.4); }

    /* Offline Banner */
    .offline-banner { background: linear-gradient(135deg, #ff6b6b, #ff8e8e); color: white; padding: 12px 20px; text-align: center; position: sticky; top: 0; z-index: 1000; }
    .offline-banner-content { display: flex; align-items: center; justify-content: center; gap: 15px; max-width: 1200px; margin: 0 auto; }
    .offline-icon { font-size: 1.2em; }
    .offline-message { font-weight: 500; }

    /* Stats Grid */
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .stat-card { background: white; padding: 25px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); display: flex; align-items: center; gap: 20px; border-left: 4px solid #4CAF50; transition: transform 0.3s ease; }
    .stat-card:hover { transform: translateY(-2px); }
    .stat-icon { font-size: 2.5em; }
    .stat-info h3 { margin: 0; font-size: 2em; color: #333; }
    .stat-info p { margin: 5px 0 0 0; color: #666; font-weight: 500; }

    /* Section Styles */
    .section { margin: 30px 0; }
    .card { background: white; padding: 25px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); border: 1px solid #e0e0e0; }
    .card h2 { margin-top: 0; color: #333; border-bottom: 2px solid #f0f0f0; padding-bottom: 15px; }

    /* Form Groups */
    .form-group { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; align-items: end; }

    /* Event Cards */
    .event-card { display: flex; justify-content: space-between; align-items: center; padding: 20px; margin: 15px 0; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #4CAF50; transition: all 0.3s ease; }
    .event-card:hover { background: #e9ecef; transform: translateX(5px); }
    .event-info { flex-grow: 1; }
    .event-info h3 { margin: 0 0 10px 0; color: #333; font-size: 1.3em; }
    .event-info p { margin: 5px 0; color: #666; }

    /* Empty States */
    .empty-state { text-align: center; padding: 40px; color: #666; font-style: italic; background: #f8f9fa; border-radius: 8px; border: 2px dashed #ddd; }
    .empty-state p { margin: 0; }

    /* Progress Section */
    .progress-section { margin-bottom: 30px; padding: 20px; background: #f8f9fa; border-radius: 8px; }
    .progress-section h3 { margin-top: 0; color: #333; }
    .progress-bar { width: 100%; height: 20px; background-color: #e0e0e0; border-radius: 10px; overflow: hidden; margin: 10px 0; }
    .progress-fill { height: 100%; background: linear-gradient(90deg, #4CAF50, #8BC34A); transition: width 0.5s ease; border-radius: 10px; }
    .progress-text { text-align: center; font-weight: bold; margin-top: 10px; color: #333; }

    /* Management Sections */
    .management-section { margin: 25px 0; padding: 20px; background: #f8f9fa; border-radius: 8px; }
    .management-section h3 { margin-top: 0; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 10px; }

    /* Participant and Contribution Items */
    .participant-item { padding: 15px; margin: 10px 0; background: white; border-radius: 8px; border-left: 3px solid #2196F3; display: flex; justify-content: space-between; align-items: center; }
    .participant-info { flex-grow: 1; }
    .participant-name { font-weight: bold; color: #333; margin-bottom: 5px; }
    .participant-details { color: #666; font-size: 0.9em; }
    .participant-actions { display: flex; gap: 5px; }
    .btn-xs { padding: 3px 8px; font-size: 11px; border-radius: 4px; }
    .btn-success { background: #4CAF50; color: white; border: none; }

    .contribution-item { padding: 15px; margin: 10px 0; background: white; border-radius: 8px; border-left: 3px solid #4CAF50; }
    .contribution-details { display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; }
    .contribution-amount { font-weight: bold; color: #4CAF50; font-size: 1.1em; }
    .contribution-meta { display: flex; justify-content: space-between; align-items: center; color: #666; font-size: 0.9em; }
    .payment-method { background: #e3f2fd; color: #1976d2; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; }

    /* PDF Actions */
    .pdf-actions { display: flex; gap: 10px; margin: 20px 0; flex-wrap: wrap; }
    .btn-pdf { background: #e74c3c; color: white; border: none; padding: 10px 15px; border-radius: 6px; font-weight: 500; }
    .btn-pdf:hover:not(:disabled) { background: #c0392b; transform: translateY(-1px); }
    .btn-pdf:disabled { opacity: 0.6; cursor: not-allowed; }

    /* SMS Templates */
    .sms-template-form { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #e0e0e0; }
    .sms-template-form h4 { margin-top: 0; color: #333; }
    .templates-list { margin: 20px 0; }
    .template-item { background: white; padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 3px solid #2196F3; }
    .template-item strong { color: #333; display: block; margin-bottom: 5px; }
    .template-item p { margin: 0; color: #666; font-style: italic; }
    .sms-actions { margin-top: 20px; text-align: center; }

    /* Modal Styles */
    .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.5); display: flex; justify-content: center; align-items: center; z-index: 1000; }
    .modal-content { background: white; padding: 0; border-radius: 10px; width: 90%; max-width: 600px; max-height: 90vh; overflow-y: auto; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3); }
    .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 20px; border-bottom: 1px solid #e0e0e0; background: #f8f9fa; border-radius: 10px 10px 0 0; }
    .modal-header h3 { margin: 0; color: #333; }
    .btn-close { background: none; border: none; font-size: 24px; cursor: pointer; color: #666; }
    .btn-close:hover { color: #333; }
    .modal-body { padding: 20px; }
    .modal-footer { padding: 20px; border-top: 1px solid #e0e0e0; display: flex; justify-content: flex-end; gap: 10px; }

    /* Participant Selection */
    .participant-selection { max-height: 200px; overflow-y: auto; border: 1px solid #ddd; border-radius: 5px; padding: 10px; margin-top: 10px; }
    .selection-actions { margin-bottom: 10px; }
    .btn-small { padding: 5px 10px; font-size: 12px; margin-right: 5px; }
    .participant-checkboxes { display: grid; gap: 8px; }
    .checkbox-item { padding: 5px; }
    .checkbox-item label { display: flex; align-items: center; gap: 8px; cursor: pointer; }

    /* Variables Info */
    .variables-info { background: #f8f9fa; padding: 15px; border-radius: 5px; margin-top: 15px; }
    .variables-info h4 { margin: 0 0 10px 0; font-size: 14px; color: #333; }
    .variables-info code { background: #e9ecef; padding: 8px; border-radius: 3px; font-family: monospace; font-size: 12px; color: #d63384; display: block; }

    /* Admin Panel Styles */
    .admin-container { max-width: 1400px; margin: 0 auto; padding: 20px; }
    .admin-header { background: linear-gradient(135deg, #8e44ad, #9b59b6); color: white; padding: 30px 0; margin: -20px -20px 30px -20px; border-radius: 0 0 15px 15px; }
    .admin-header-content { max-width: 1400px; margin: 0 auto; padding: 0 20px; display: flex; justify-content: space-between; align-items: center; }
    .admin-header h1 { margin: 0; font-size: 2.5em; }

    /* Admin Stats Grid */
    .admin-stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 30px 0; }
    .admin-stat-card { background: white; padding: 25px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); display: flex; align-items: center; gap: 20px; border-left: 4px solid #8e44ad; }
    .admin-stat-card:hover { transform: translateY(-2px); }
    .admin-stat-icon { font-size: 2.5em; }
    .admin-stat-info h3 { margin: 0; font-size: 2em; color: #333; }
    .admin-stat-info p { margin: 5px 0 0 0; color: #666; font-weight: 500; }

    /* Admin Table */
    .admin-table-container { overflow-x: auto; margin: 20px 0; }
    .admin-table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .admin-table th, .admin-table td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #e0e0e0; }
    .admin-table th { background: #f8f9fa; font-weight: 600; color: #333; font-size: 0.9em; }
    .admin-table tr:hover { background: #f8f9fa; }

    /* Admin Badges */
    .admin-badge { background: #8e44ad; color: white; padding: 4px 8px; border-radius: 12px; font-size: 0.8em; font-weight: 500; }
    .current-user-badge { background: #3498db; color: white; padding: 2px 6px; border-radius: 8px; font-size: 0.7em; margin-left: 5px; }
    .admin-status.is-admin { color: #27ae60; font-weight: 600; }

    /* Action Buttons */
    .action-buttons { display: flex; gap: 5px; flex-wrap: wrap; }
    .btn-info { background: #3498db; color: white; border: none; }
    .btn-warning { background: #f39c12; color: white; border: none; }
    .btn-danger { background: #e74c3c; color: white; border: none; }
    .btn-admin { background: rgba(142, 68, 173, 0.2); color: white; border: 1px solid rgba(142, 68, 173, 0.5); padding: 8px 16px; border-radius: 20px; font-weight: 500; }
    .btn-admin:hover { background: rgba(142, 68, 173, 0.4); }

    /* Admin PDF Actions */
    .admin-pdf-actions { text-align: center; margin: 30px 0 10px 0; }

    /* User Details */
    .user-details-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #f0f0f0; }

    /* Animations */
    @keyframes pulse {
      0% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.1); }
      100% { opacity: 1; transform: scale(1); }
    }

    /* Responsive Design */
    @media (max-width: 768px) {
      .header-content { flex-direction: column; text-align: center; gap: 15px; }
      .online-status-section { flex-direction: column; gap: 10px; align-items: flex-end; }
      .sync-status { flex-direction: column; gap: 10px; align-items: flex-start; }
      .sync-actions { align-self: stretch; }
      .sync-actions .btn { flex: 1; text-align: center; }
      .stats-grid, .admin-stats-grid { grid-template-columns: 1fr; }
      .form-group { grid-template-columns: 1fr; }
      .event-card { flex-direction: column; text-align: center; gap: 15px; }
      .participant-item { flex-direction: column; align-items: flex-start; gap: 10px; }
      .participant-actions { align-self: flex-end; }
      .contribution-details, .contribution-meta { flex-direction: column; align-items: flex-start; gap: 5px; }
      .pdf-actions { flex-direction: column; }
      .admin-header-content { flex-direction: column; gap: 15px; text-align: center; }
      .admin-table { font-size: 0.8em; }
      .action-buttons { flex-direction: column; }
      .user-details-header { flex-direction: column; gap: 15px; text-align: center; }
      .offline-banner-content { flex-direction: column; gap: 10px; text-align: center; }
      .dashboard-container { padding: 10px; }
      .auth-card { padding: 30px 20px; }
      .modal-content { width: 95%; margin: 10px; }
      .modal-footer { flex-direction: column; }
    }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  // ==================== COMPONENT PROPERTIES ====================
  
  // App states
  currentView: 'auth' | 'dashboard' | 'admin' = 'auth';
  authStep: 'input' | 'otp' = 'input';
  user: any = null;
  isAdminUser: boolean = false;
  
  // Online/Sync status
  syncStatus: SyncStatus = {
    online: true,
    lastSync: null,
    pendingChanges: 0,
    syncing: false
  };
  
  // Subscriptions
  private syncStatusSubscription?: Subscription;
  private recaptchaVerifier: RecaptchaVerifier | null = null;

  // Authentication
  authData = {
    phoneOrEmail: '',
    otp: '',
    displayName: '',
    otpMethod: 'sms' as 'sms' | 'email',
    isLogin: true
  };

  otpCountdown = 0;
  otpTimer: any = null;
  canResendOTP = false;

  // Event data
  events: Event[] = [];
  participants: Participant[] = [];
  contributions: Contribution[] = [];
  smsTemplates: SMSTemplate[] = [];
  
  // Admin data
  adminStats: AdminStats = {
    totalUsers: 0,
    totalEvents: 0,
    totalParticipants: 0,
    totalContributions: 0,
    totalMoneyCollected: 0,
    recentActivity: []
  };
  
  allUsers: User[] = [];
  allEvents: Event[] = [];
  allParticipants: Participant[] = [];
  allContributions: Contribution[] = [];
  
  selectedUser: User | null = null;
  userEvents: Event[] = [];
  userParticipants: Participant[] = [];
  userContributions: Contribution[] = [];

  // Form data
  newEvent: any = {
    name: '',
    type: '',
    date: '',
    location: '',
    targetAmount: 0
  };
  
  newParticipant: any = {
    name: '',
    phone: '',
    email: '',
    place: ''
  };
  
  newContribution: any = {
    participantId: '',
    amount: 0,
    paymentMethod: 'cash',
    notes: ''
  };

  // SMS Features
  newSmsTemplate: any = {
    name: '',
    message: ''
  };
  
  selectedSmsTemplate: string = '';
  customSmsMessage: string = '';
  showSmsModal: boolean = false;
  smsRecipients: 'all' | 'selected' | 'contributors' = 'all';
  selectedParticipantsForSms: string[] = [];
  
  selectedEvent: Event | null = null;
  dashboardStats: any = {};

  // Offline support
  private pendingWrites: any[] = [];
  private isManualOfflineMode = false;

  constructor(
    private firestore: Firestore,
    private auth: Auth
  ) {
    this.initializeOnlineStatus();
    this.initializeFirestoreOfflinePersistence();
  }

  // ==================== LIFECYCLE METHODS ====================

  ngOnInit() {
    this.addRecaptchaContainer();
    
    // Subscribe to auth state changes
    onAuthStateChanged(this.auth, async (user) => {
      this.user = user;
      if (user) {
        // Check if user is admin
        this.isAdminUser = await this.isAdmin();
        
        this.currentView = 'dashboard';
        this.loadEvents();
        this.loadDashboardStats();
        
        // Load admin data if user is admin
        if (this.isAdminUser) {
          this.loadAdminData();
        }
      } else {
        this.currentView = 'auth';
        this.resetAuthData();
      }
    });
  }

  ngOnDestroy() {
    this.syncStatusSubscription?.unsubscribe();
  }

  // ==================== AUTHENTICATION METHODS ====================

  private addRecaptchaContainer() {
    if (!document.getElementById('recaptcha-container')) {
      const recaptchaDiv = document.createElement('div');
      recaptchaDiv.id = 'recaptcha-container';
      recaptchaDiv.style.display = 'none';
      document.body.appendChild(recaptchaDiv);
    }
  }

  async requestOTP() {
    if (!this.authData.phoneOrEmail.trim()) {
      alert('தொலைபேசி எண் அல்லது மின்னஞ்சலை உள்ளிடவும்');
      return;
    }

    // Detect if input is email or phone
    const isEmail = this.authData.phoneOrEmail.includes('@');
    this.authData.otpMethod = isEmail ? 'email' : 'sms';

    try {
      const result = await this.sendOTP(this.authData.phoneOrEmail);
      
      if (result.success) {
        this.authStep = 'otp';
        this.startOTPTimer();
        alert('OTP அனுப்பப்பட்டது');
      } else {
        alert('OTP அனுப்புவதில் பிழை: ' + result.message);
      }
    } catch (error: any) {
      alert('OTP அனுப்புவதில் பிழை: ' + error.message);
    }
  }

  async verifyOTP() {
    if (!this.authData.otp.trim() || this.authData.otp.length !== 6) {
      alert('சரியான 6-இலக்க OTP ஐ உள்ளிடவும்');
      return;
    }

    try {
      const displayName = this.authData.displayName.trim() || undefined;
      const result = await this.verifyOTPCode(
        this.authData.phoneOrEmail, 
        this.authData.otp, 
        displayName
      );

      if (result.success) {
        alert('OTP சரிபாதிப்பு வெற்றி!');
        this.resetAuthData();
      } else {
        alert('OTP சரிபாதிப்பு தோல்வி: ' + result.message);
      }
    } catch (error: any) {
      alert('OTP சரிபாதிப்பு தோல்வி: ' + error.message);
    }
  }

  private async sendOTP(phoneOrEmail: string): Promise<{success: boolean, message: string}> {
    try {
      if (this.isEmail(phoneOrEmail)) {
        // Email OTP - Mock implementation
        const otp = this.generateOTP();
        console.log(`Sending OTP ${otp} to email: ${phoneOrEmail}`);
        return { success: true, message: 'OTP sent to email' };
      } else if (this.isPhoneNumber(phoneOrEmail)) {
        // SMS OTP - Mock implementation
        console.log(`Sending OTP to phone: ${phoneOrEmail}`);
        return { success: true, message: 'OTP sent to phone' };
      } else {
        return { success: false, message: 'Invalid phone number or email' };
      }
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  private async verifyOTPCode(phoneOrEmail: string, otp: string, displayName?: string): Promise<{success: boolean, message: string}> {
    try {
      // Mock verification - always success for demo
      if (otp === '123456') {
        // Create mock user
        const mockUser = {
          uid: 'mock-user-' + Date.now(),
          email: this.isEmail(phoneOrEmail) ? phoneOrEmail : undefined,
          phone: this.isPhoneNumber(phoneOrEmail) ? phoneOrEmail : undefined,
          displayName: displayName || 'User',
          createdAt: new Date()
        };
        
        this.user = mockUser;
        return { success: true, message: 'Login successful!' };
      } else {
        return { success: false, message: 'Invalid OTP' };
      }
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  private generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private isEmail(phoneOrEmail: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(phoneOrEmail);
  }

  private isPhoneNumber(phoneOrEmail: string): boolean {
    const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
    return phoneRegex.test(phoneOrEmail.replace(/\D/g, ''));
  }

  // OTP Timer Methods
  startOTPTimer() {
    this.otpCountdown = 60;
    this.canResendOTP = false;
    
    this.otpTimer = setInterval(() => {
      this.otpCountdown--;
      
      if (this.otpCountdown <= 0) {
        this.canResendOTP = true;
        clearInterval(this.otpTimer);
      }
    }, 1000);
  }

  resendOTP() {
    if (this.canResendOTP) {
      this.requestOTP();
    }
  }

  backToInput() {
    this.authStep = 'input';
    this.authData.otp = '';
    
    if (this.otpTimer) {
      clearInterval(this.otpTimer);
    }
  }

  resetAuthData() {
    this.authData = {
      phoneOrEmail: '',
      otp: '',
      displayName: '',
      otpMethod: 'sms',
      isLogin: true
    };
    this.authStep = 'input';
    
    if (this.otpTimer) {
      clearInterval(this.otpTimer);
    }
    this.otpCountdown = 0;
    this.canResendOTP = false;
  }

  async logout() {
    this.user = null;
    this.resetAppState();
    this.resetAuthData();
    this.currentView = 'auth';
  }

  // ==================== EVENT MANAGEMENT METHODS ====================

  async createEvent() {
    if (!this.newEvent.name || !this.newEvent.date) {
      alert('தயவு செய்து அனைத்து புலங்களையும் நிரப்பவும்');
      return;
    }

    try {
      const eventId = await this.addEvent({
        ...this.newEvent,
        targetAmount: Number(this.newEvent.targetAmount)
      });
      
      this.newEvent = {
        name: '',
        type: '',
        date: '',
        location: '',
        targetAmount: 0
      };
      
      if (this.syncStatus.online) {
        alert('விழா வெற்றிகரமாக உருவாக்கப்பட்டது!');
      } else {
        alert('விழா உருவாக்கப்பட்டது (ஆஃப்லைன் - ஒத்திவைக்கப்படும்)');
      }
    } catch (error) {
      alert('விழாவை உருவாக்குவதில் பிழை: ' + error);
    }
  }

  async addParticipant() {
    if (!this.selectedEvent) {
      alert('முதலில் ஒரு விழாவைத் தேர்ந்தெடுக்கவும்');
      return;
    }

    if (!this.newParticipant.name || !this.newParticipant.phone) {
      alert('பங்கேற்பாளர் பெயர் மற்றும் தொலைபேசி எண்ணை உள்ளிடவும்');
      return;
    }

    try {
      await this.addParticipantToEvent({
        ...this.newParticipant,
        eventId: this.selectedEvent.id!
      });
      
      this.newParticipant = {
        name: '',
        phone: '',
        email: '',
        place: ''
      };
      
      if (this.syncStatus.online) {
        alert('பங்கேற்பாளர் வெற்றிகரமாக சேர்க்கப்பட்டது!');
      } else {
        alert('பங்கேற்பாளர் சேர்க்கப்பட்டார் (ஆஃப்லைன் - ஒத்திவைக்கப்படும்)');
      }
    } catch (error) {
      alert('பங்கேற்பாளரைச் சேர்க்கும்போது பிழை: ' + error);
    }
  }

  async addContribution() {
    if (!this.selectedEvent) {
      alert('முதலில் ஒரு விழாவைத் தேர்ந்தெடுக்கவும்');
      return;
    }

    if (!this.newContribution.participantId || !this.newContribution.amount) {
      alert('பங்கேற்பாளர் மற்றும் தொகையைத் தேர்ந்தெடுக்கவும்');
      return;
    }

    try {
      const selectedParticipant = this.participants.find(p => p.id === this.newContribution.participantId);
      
      await this.addContributionToEvent({
        ...this.newContribution,
        eventId: this.selectedEvent.id!,
        participantName: selectedParticipant?.name,
        participantPhone: selectedParticipant?.phone,
        participantPlace: selectedParticipant?.place,
        amount: Number(this.newContribution.amount),
        date: new Date()
      });
      
      this.newContribution = {
        participantId: '',
        amount: 0,
        paymentMethod: 'cash',
        notes: ''
      };
      
      if (this.syncStatus.online) {
        alert('பங்களிப்பு வெற்றிகரமாக பதிவு செய்யப்பட்டது!');
      } else {
        alert('பங்களிப்பு பதிவு செய்யப்பட்டது (ஆஃப்லைன் - ஒத்திவைக்கப்படும்)');
      }
      
      this.loadDashboardStats();
    } catch (error) {
      alert('பங்களிப்பைப் பதிவு செய்யும்போது பிழை: ' + error);
    }
  }

  selectEvent(event: Event) {
    this.selectedEvent = event;
    this.loadParticipants();
    this.loadContributions();
    this.loadSmsTemplates();
  }

  getTotalCollected(): number {
    return this.contributions.reduce((sum, c) => sum + c.amount, 0);
  }

  getProgressPercentage(): number {
    if (!this.selectedEvent?.targetAmount) return 0;
    return (this.getTotalCollected() / this.selectedEvent.targetAmount) * 100;
  }

  getRemainingAmount(): number {
    if (!this.selectedEvent?.targetAmount) return 0;
    return this.selectedEvent.targetAmount - this.getTotalCollected();
  }

  // ==================== DATA MANAGEMENT METHODS ====================

  private async addEvent(event: Omit<Event, 'id' | 'userId'>): Promise<string> {
    const eventData = {
      ...event,
      userId: this.user?.uid || 'mock-user',
      createdAt: new Date(),
      _localId: this.generateLocalId(),
      _pendingSync: !this.syncStatus.online
    };

    if (this.syncStatus.online) {
      // Mock successful addition
      const newEvent = { ...eventData, id: this.generateLocalId() } as Event;
      this.events.push(newEvent);
      return newEvent.id!;
    } else {
      this.addPendingWrite('events', eventData);
      return eventData._localId!;
    }
  }

  private async addParticipantToEvent(participant: Omit<Participant, 'id' | 'userId'>) {
    const participantData = {
      ...participant,
      userId: this.user?.uid || 'mock-user',
      _localId: this.generateLocalId(),
      _pendingSync: !this.syncStatus.online
    };

    if (this.syncStatus.online) {
      const newParticipant = { ...participantData, id: this.generateLocalId() } as Participant;
      this.participants.push(newParticipant);
    } else {
      this.addPendingWrite('participants', participantData);
    }
  }

  private async addContributionToEvent(contribution: Omit<Contribution, 'id' | 'userId'>) {
    const contributionData = {
      ...contribution,
      userId: this.user?.uid || 'mock-user',
      _localId: this.generateLocalId(),
      _pendingSync: !this.syncStatus.online
    };

    if (this.syncStatus.online) {
      const newContribution = { ...contributionData, id: this.generateLocalId() } as Contribution;
      this.contributions.push(newContribution);
    } else {
      this.addPendingWrite('contributions', contributionData);
    }
  }

  private generateLocalId(): string {
    return 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  private loadEvents() {
    // Mock data for demonstration
    if (this.events.length === 0) {
      this.events = [
        {
          id: '1',
          name: 'திருமண விழா',
          type: 'திருமணம்',
          date: '2024-12-25',
          location: 'சென்னை',
          targetAmount: 50000,
          createdAt: new Date(),
          userId: this.user?.uid || 'mock-user'
        }
      ];
    }
  }

  private loadParticipants() {
    if (!this.selectedEvent) return;

    // Mock data
    this.participants = [
      {
        id: '1',
        eventId: this.selectedEvent.id!,
        name: 'ராஜ்',
        phone: '9876543210',
        email: 'raj@example.com',
        place: 'சென்னை',
        userId: this.user?.uid || 'mock-user'
      }
    ];
  }

  private loadContributions() {
    if (!this.selectedEvent) return;

    // Mock data
    this.contributions = [
      {
        id: '1',
        eventId: this.selectedEvent.id!,
        participantId: '1',
        participantName: 'ராஜ்',
        participantPhone: '9876543210',
        participantPlace: 'சென்னை',
        amount: 5000,
        paymentMethod: 'cash',
        date: new Date(),
        userId: this.user?.uid || 'mock-user'
      }
    ];
  }

  private async loadDashboardStats() {
    this.dashboardStats = {
      eventsCount: this.events.length,
      totalCollected: this.getTotalCollected()
    };
  }

  // ==================== SMS FUNCTIONALITY ====================

  async createSmsTemplate() {
    if (!this.newSmsTemplate.name || !this.newSmsTemplate.message) {
      alert('டெம்ப்ளேட் பெயர் மற்றும் செய்தியை உள்ளிடவும்');
      return;
    }

    try {
      const templateData = {
        ...this.newSmsTemplate,
        eventId: this.selectedEvent?.id,
        userId: this.user?.uid || 'mock-user'
      };

      const newTemplate = { ...templateData, id: this.generateLocalId() } as SMSTemplate;
      this.smsTemplates.push(newTemplate);
      
      this.newSmsTemplate = {
        name: '',
        message: ''
      };
      
      alert('SMS டெம்ப்ளேட் வெற்றிகரமாக உருவாக்கப்பட்டது!');
    } catch (error) {
      alert('டெம்ப்ளேட்டை உருவாக்குவதில் பிழை: ' + error);
    }
  }

  private loadSmsTemplates() {
    // Mock templates
    this.smsTemplates = [
      {
        id: '1',
        name: 'வரவேற்பு செய்தி',
        message: 'வணக்கம் {{name}}, {{eventName}} விழாவில் பங்கேற்க வரவேற்கிறோம்!',
        eventId: this.selectedEvent?.id,
        userId: this.user?.uid || 'mock-user'
      }
    ];
  }

  openSmsModal() {
    this.showSmsModal = true;
    this.selectedSmsTemplate = '';
    this.customSmsMessage = '';
    this.smsRecipients = 'all';
    this.selectedParticipantsForSms = [];
  }

  closeSmsModal() {
    this.showSmsModal = false;
  }

  onTemplateSelect() {
    const selectedTemplate = this.smsTemplates.find(t => t.id === this.selectedSmsTemplate);
    if (selectedTemplate) {
      this.customSmsMessage = selectedTemplate.message;
    }
  }

  toggleParticipantSelection(participantId: string) {
    const index = this.selectedParticipantsForSms.indexOf(participantId);
    if (index > -1) {
      this.selectedParticipantsForSms.splice(index, 1);
    } else {
      this.selectedParticipantsForSms.push(participantId);
    }
  }

  selectAllParticipants() {
    this.selectedParticipantsForSms = this.participants.map(p => p.id!);
  }

  deselectAllParticipants() {
    this.selectedParticipantsForSms = [];
  }

  async sendBulkSMS() {
    if (!this.customSmsMessage.trim()) {
      alert('செய்தியை உள்ளிடவும்');
      return;
    }

    let recipients: Participant[] = [];

    if (this.smsRecipients === 'all') {
      recipients = this.participants;
    } else if (this.smsRecipients === 'selected') {
      if (this.selectedParticipantsForSms.length === 0) {
        alert('பங்கேற்பாளர்கள் தேர்ந்தெடுக்கப்படவில்லை');
        return;
      }
      recipients = this.participants.filter(p => this.selectedParticipantsForSms.includes(p.id!));
    } else if (this.smsRecipients === 'contributors') {
      const contributorIds = [...new Set(this.contributions.map(c => c.participantId))];
      recipients = this.participants.filter(p => contributorIds.includes(p.id!));
    }

    recipients = recipients.filter(p => p.phone && p.phone.trim());

    if (recipients.length === 0) {
      alert('அனுப்ப பங்கேற்பாளர்கள் இல்லை');
      return;
    }

    try {
      let successCount = 0;
      for (const participant of recipients) {
        const personalizedMessage = this.customSmsMessage
          .replace(/{{name}}/g, participant.name)
          .replace(/{{eventName}}/g, this.selectedEvent?.name || '')
          .replace(/{{eventDate}}/g, this.selectedEvent?.date || '')
          .replace(/{{eventLocation}}/g, this.selectedEvent?.location || '')
          .replace(/{{place}}/g, participant.place || '');

        const result = await this.sendSMS(participant.phone, personalizedMessage);
        if (result.success) successCount++;
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      alert(`SMS அனுப்பப்பட்டது: ${successCount} வெற்றி`);
      this.closeSmsModal();
    } catch (error) {
      alert('SMS அனுப்புவதில் பிழை: ' + error);
    }
  }

  async sendWelcomeSMS(participant: Participant) {
    const message = `வணக்கம் {{name}}, {{eventName}} விழாவில் பங்கேற்க வரவேற்கிறோம்!`
      .replace(/{{name}}/g, participant.name)
      .replace(/{{eventName}}/g, this.selectedEvent?.name || '');

    const result = await this.sendSMS(participant.phone, message);
    
    if (result.success) {
      alert('SMS வெற்றிகரமாக அனுப்பப்பட்டது!');
    } else {
      alert('SMS அனுப்புவதில் பிழை');
    }
  }

  async sendThanksSMS(participant: Participant) {
    const message = `அன்புள்ள {{name}}, {{eventName}} விழாவில் பங்களித்தமைக்கு மிக்க நன்றி!`
      .replace(/{{name}}/g, participant.name)
      .replace(/{{eventName}}/g, this.selectedEvent?.name || '');

    const result = await this.sendSMS(participant.phone, message);
    
    if (result.success) {
      alert('SMS வெற்றிகரமாக அனுப்பப்பட்டது!');
    } else {
      alert('SMS அனுப்புவதில் பிழை');
    }
  }

  private async sendSMS(phoneNumber: string, message: string): Promise<{success: boolean}> {
    // Mock SMS sending
    console.log(`Sending SMS to ${phoneNumber}: ${message}`);
    return { success: true };
  }

  // ==================== ADMIN FUNCTIONALITY ====================

  private async isAdmin(): Promise<boolean> {
    // Mock admin check - first user becomes admin
    return this.user?.uid === 'mock-user';
  }

  private async loadAdminData() {
    if (!this.isAdminUser) return;

    // Mock admin data
    this.adminStats = {
      totalUsers: 5,
      totalEvents: 10,
      totalParticipants: 50,
      totalContributions: 100,
      totalMoneyCollected: 250000,
      recentActivity: []
    };

    this.loadAllUsers();
    this.loadAllEvents();
    this.loadAllParticipants();
    this.loadAllContributions();
  }

  private loadAllUsers() {
    this.allUsers = [
      {
        uid: 'mock-user',
        email: 'admin@example.com',
        displayName: 'நிர்வாகி',
        createdAt: new Date(),
        isAdmin: true
      }
    ];
  }

  private loadAllEvents() {
    this.allEvents = this.events;
  }

  private loadAllParticipants() {
    this.allParticipants = this.participants;
  }

  private loadAllContributions() {
    this.allContributions = this.contributions;
  }

  goToAdminPanel() {
    if (this.isAdminUser) {
      this.currentView = 'admin';
      this.loadAdminData();
    }
  }

  goToDashboard() {
    this.currentView = 'dashboard';
    this.selectedUser = null;
  }

  async makeUserAdmin(user: User) {
    if (confirm(`"${user.displayName}"-ஐ நிர்வாகியாக்க வேண்டுமா?`)) {
      user.isAdmin = true;
      user.adminSince = new Date();
      alert('நிர்வாக உரிமைகள் வழங்கப்பட்டன');
    }
  }

  async removeUserAdmin(user: User) {
    if (confirm(`"${user.displayName}"-இன் நிர்வாக உரிமைகளை நீக்க வேண்டுமா?`)) {
      user.isAdmin = false;
      user.adminSince = undefined;
      alert('நிர்வாக உரிமைகள் நீக்கப்பட்டன');
      
      if (user.uid === this.user?.uid) {
        this.isAdminUser = false;
        this.currentView = 'dashboard';
      }
    }
  }

  async viewUserData(user: User) {
    this.selectedUser = user;
    this.userEvents = this.events.filter(e => e.userId === user.uid);
    this.userParticipants = this.participants.filter(p => p.userId === user.uid);
    this.userContributions = this.contributions.filter(c => c.userId === user.uid);
  }

  // ==================== PDF FUNCTIONALITY ====================

  downloadEventReport() {
    if (!this.selectedEvent) {
      alert('அறிக்கையைப் பதிவிறக்க விழாவைத் தேர்ந்தெடுக்கவும்');
      return;
    }

    this.generateEventReport(
      this.selectedEvent,
      this.participants,
      this.contributions
    );
  }

  downloadParticipantList() {
    if (this.participants.length === 0) {
      alert('பதிவிறக்க பங்கேற்பாளர்கள் இல்லை');
      return;
    }

    this.generateParticipantList(
      this.participants,
      this.selectedEvent?.name
    );
  }

  downloadContributionReport() {
    if (this.contributions.length === 0) {
      alert('பதிவிறக்க பங்களிப்புகள் இல்லை');
      return;
    }

    this.generateContributionReport(
      this.contributions,
      this.selectedEvent?.name
    );
  }

  downloadAdminReport() {
    if (!this.isAdminUser) return;

    this.generateAdminReport(
      this.allUsers,
      this.allEvents,
      this.allParticipants,
      this.allContributions,
      this.adminStats
    );
  }

  private generateEventReport(event: Event, participants: Participant[], contributions: Contribution[]) {
    const totalCollected = contributions.reduce((sum, c) => sum + c.amount, 0);
    const progressPercentage = event.targetAmount > 0 ? (totalCollected / event.targetAmount) * 100 : 0;

    const report = `
விழா அறிக்கை

விழா பெயர்: ${event.name}
விழா வகை: ${event.type}
தேதி: ${event.date}
இடம்: ${event.location}
இலக்கு தொகை: ₹${event.targetAmount}
திரட்டப்பட்ட தொகை: ₹${totalCollected}
முன்னேற்றம்: ${progressPercentage.toFixed(1)}%

பங்கேற்பாளர்கள் (${participants.length}):
${participants.map(p => `- ${p.name} | ${p.phone} | ${p.email || '-'} | ${p.place || '-'}`).join('\n')}

பங்களிப்புகள் (${contributions.length}):
${contributions.map(c => `- ${c.participantName} | ₹${c.amount} | ${c.paymentMethod} | ${c.date}`).join('\n')}

சுருக்கம்:
மொத்த பங்கேற்பாளர்கள்: ${participants.length}
மொத்த பங்களிப்புகள்: ${contributions.length}
மொத்த திரட்டப்பட்ட தொகை: ₹${totalCollected}
இலக்கை அடைவது: ${progressPercentage.toFixed(1)}%
    `;

    this.downloadTextFile(report, `${event.name}_Report.txt`);
  }

  private generateParticipantList(participants: Participant[], eventName?: string) {
    const content = `
${eventName ? `${eventName} - பங்கேற்பாளர்கள்` : 'பங்கேற்பாளர்கள்'}

${participants.map(p => `- ${p.name} | ${p.phone} | ${p.email || '-'} | ${p.place || '-'}`).join('\n')}

மொத்த பங்கேற்பாளர்கள்: ${participants.length}
    `;

    this.downloadTextFile(content, 'Participants_List.txt');
  }

  private generateContributionReport(contributions: Contribution[], eventName?: string) {
    const totalAmount = contributions.reduce((sum, c) => sum + c.amount, 0);

    const content = `
${eventName ? `${eventName} - பங்களிப்புகள்` : 'பங்களிப்புகள்'}

${contributions.map(c => `- ${c.participantName} | ₹${c.amount} | ${c.paymentMethod} | ${c.date}`).join('\n')}

மொத்த பங்களிப்புகள்: ${contributions.length}
மொத்த தொகை: ₹${totalAmount}
    `;

    this.downloadTextFile(content, 'Contributions_Report.txt');
  }

  private generateAdminReport(users: User[], events: Event[], participants: Participant[], contributions: Contribution[], stats: any) {
    const totalMoney = contributions.reduce((sum, c) => sum + c.amount, 0);

    const content = `
நிர்வாக அறிக்கை

புள்ளிவிவரங்கள்:
மொத்த பயனர்கள்: ${stats.totalUsers}
மொத்த விழாக்கள்: ${stats.totalEvents}
மொத்த பங்கேற்பாளர்கள்: ${stats.totalParticipants}
மொத்த பங்களிப்புகள்: ${stats.totalContributions}
மொத்த திரட்டப்பட்ட தொகை: ₹${totalMoney}

பயனர் சுருக்கம்:
${users.map(user => `- ${user.displayName} | ${user.email || user.phone || '-'} | ${user.isAdmin ? 'ஆம்' : 'இல்லை'}`).join('\n')}
    `;

    this.downloadTextFile(content, 'Admin_Report.txt');
  }

  private downloadTextFile(content: string, filename: string) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(url);
  }

  // ==================== OFFLINE SYNC FUNCTIONALITY ====================

  private initializeOnlineStatus() {
    const online$ = fromEvent(window, 'online').pipe(map(() => true));
    const offline$ = fromEvent(window, 'offline').pipe(map(() => false));
    
    const networkStatus$ = merge(online$, offline$).pipe(
      startWith(navigator.onLine),
      debounceTime(300)
    );

    networkStatus$.subscribe(async (online) => {
      await this.handleNetworkChange(online);
    });

    this.startPeriodicSync();
  }

  private async initializeFirestoreOfflinePersistence() {
    try {
      await enableIndexedDbPersistence(this.firestore);
      console.log('Offline persistence enabled');
    } catch (error) {
      console.error('Offline persistence failed:', error);
    }
  }

  private async handleNetworkChange(online: boolean) {
    if (online && !this.syncStatus.online && !this.isManualOfflineMode) {
      await this.syncPendingChanges();
    }

    this.syncStatus = {
      ...this.syncStatus,
      online,
      syncing: online && this.pendingWrites.length > 0
    };

    this.showNetworkNotification(online);
  }

  private showNetworkNotification(online: boolean) {
    if (online) {
      console.log('Connected to internet');
    } else {
      console.log('Working offline');
    }
  }

  private startPeriodicSync() {
    timer(0, 30000).pipe(
      switchMap(async () => {
        if (this.syncStatus.online && this.pendingWrites.length > 0) {
          await this.syncPendingChanges();
        }
        return null;
      })
    ).subscribe();
  }

  private addPendingWrite(collection: string, data: any) {
    const write = {
      collection,
      data,
      timestamp: new Date(),
      retryCount: 0
    };

    this.pendingWrites.push(write);
    
    this.syncStatus = {
      ...this.syncStatus,
      pendingChanges: this.pendingWrites.length,
      syncing: this.syncStatus.online
    };

    if (this.syncStatus.online) {
      this.syncPendingChanges();
    }
  }

  private async syncPendingChanges() {
    if (this.pendingWrites.length === 0 || !this.syncStatus.online) {
      return;
    }

    this.syncStatus = { ...this.syncStatus, syncing: true };

    // Mock sync process
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    this.pendingWrites = [];
    this.syncStatus = {
      ...this.syncStatus,
      pendingChanges: 0,
      lastSync: new Date(),
      syncing: false
    };

    console.log('Sync completed');
  }

  async manualSync() {
    if (!this.syncStatus.online) {
      alert('ஆன்லைன் அல்ல, ஒத்திவைக்க முடியாது');
      return;
    }

    await this.syncPendingChanges();
  }

  async toggleOfflineMode() {
    const currentlyOnline = this.syncStatus.online;
    this.isManualOfflineMode = currentlyOnline;
    
    if (currentlyOnline) {
      this.syncStatus = { ...this.syncStatus, online: false };
      console.log('Manual offline mode enabled');
    } else {
      this.syncStatus = { ...this.syncStatus, online: navigator.onLine };
      await this.syncPendingChanges();
      console.log('Back to online mode');
    }
  }

  // ==================== HELPER METHODS ====================

  private resetAppState() {
    this.events = [];
    this.participants = [];
    this.contributions = [];
    this.smsTemplates = [];
    this.selectedEvent = null;
    this.dashboardStats = {};
    this.pendingWrites = [];
  }
}
