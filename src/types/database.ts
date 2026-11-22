/**
 * Shared TypeScript Schema & Domain Types for CITS Camp Operations
 * Part A: Canonical PostgreSQL Raw Database Schema (Tables, Row/Insert/Update, Relationships, Functions, Enums)
 * Part B: Frontend Operational Domain Types (Cleanly separated from raw snake_case DB rows)
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// =============================================================================
// PART A: RAW POSTGRESQL SCHEMA TYPES (Matches 0001 + 0002 Migrations Exactly)
// =============================================================================

export type DbUserRole = 'admin' | 'instructor';
export type DbCampStatus = 'draft' | 'active' | 'pending_archive' | 'archived';
export type DbLectureStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
export type DbCheckinStatus =
  | 'verified'
  | 'outside_geofence'
  | 'late_first_lecture'
  | 'exception_pending'
  | 'exception_approved'
  | 'exception_rejected';
export type DbAttendanceSheetStatus = 'draft' | 'submitted' | 'locked';
export type DbOfflineSyncState = 'Offline' | 'Syncing' | 'Synced' | 'Failed';
export type DbAttendanceMark = 'present' | 'absent' | 'late' | 'excused';
export type DbEntitlementStatus = 'eligible' | 'pending_review' | 'approved' | 'excluded';
export type DbRequestStatus = 'pending' | 'approved' | 'rejected';
export type DbIssueSeverity = 'low' | 'medium' | 'high' | 'critical';
export type DbIssueStatus = 'open' | 'in_progress' | 'resolved';
export type DbBackupType = 'full_json_export' | 'camp_archive_bundle' | 'pre_restore_snapshot';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          role: DbUserRole;
          username: string;
          email: string;
          full_name_en: string;
          full_name_ar: string;
          phone: string | null;
          must_change_password: boolean;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          role: DbUserRole;
          username: string;
          email: string;
          full_name_en: string;
          full_name_ar: string;
          phone?: string | null;
          must_change_password?: boolean;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          role?: DbUserRole;
          username?: string;
          email?: string;
          full_name_en?: string;
          full_name_ar?: string;
          phone?: string | null;
          must_change_password?: boolean;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'profiles_id_fkey';
            columns: ['id'];
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
      admin_accounts: {
        Row: {
          id: string;
          profile_id: string;
          totp_enrolled: boolean;
          totp_verified_at: string | null;
          assigned_slot: 1 | 2;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          totp_enrolled?: boolean;
          totp_verified_at?: string | null;
          assigned_slot: 1 | 2;
          created_at?: string;
        };
        Update: {
          totp_enrolled?: boolean;
          totp_verified_at?: string | null;
          assigned_slot?: 1 | 2;
        };
        Relationships: [
          {
            foreignKeyName: 'admin_accounts_profile_id_fkey';
            columns: ['profile_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      instructors: {
        Row: {
          id: string;
          profile_id: string;
          instructor_code: string;
          specialization: string;
          default_lecture_rate_egp: number;
          bio: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          instructor_code: string;
          specialization: string;
          default_lecture_rate_egp?: number;
          bio?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          instructor_code?: string;
          specialization?: string;
          default_lecture_rate_egp?: number;
          bio?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'instructors_profile_id_fkey';
            columns: ['profile_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      venues: {
        Row: {
          id: string;
          name_en: string;
          name_ar: string;
          address: string;
          latitude: number;
          longitude: number;
          geofence_radius_meters: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          name_en: string;
          name_ar: string;
          address: string;
          latitude: number;
          longitude: number;
          geofence_radius_meters?: number;
          created_at?: string;
        };
        Update: {
          name_en?: string;
          name_ar?: string;
          address?: string;
          latitude?: number;
          longitude?: number;
          geofence_radius_meters?: number;
        };
        Relationships: [];
      };
      camps: {
        Row: {
          id: string;
          code: string;
          name_en: string;
          name_ar: string;
          status: DbCampStatus;
          venue_id: string;
          start_date: string;
          end_date: string;
          duration_days: number;
          current_camp_day: number;
          template_source_camp_id: string | null;
          archived_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          name_en: string;
          name_ar: string;
          status?: DbCampStatus;
          venue_id: string;
          start_date: string;
          end_date: string;
          duration_days?: number;
          current_camp_day?: number;
          template_source_camp_id?: string | null;
          archived_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          code?: string;
          name_en?: string;
          name_ar?: string;
          status?: DbCampStatus;
          venue_id?: string;
          start_date?: string;
          end_date?: string;
          duration_days?: number;
          current_camp_day?: number;
          archived_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'camps_venue_id_fkey';
            columns: ['venue_id'];
            referencedRelation: 'venues';
            referencedColumns: ['id'];
          }
        ];
      };
      camp_settings: {
        Row: {
          id: string;
          camp_id: string;
          default_lecture_duration_hours: number;
          max_instructor_groups_per_day: number;
          geofence_radius_meters: number;
          first_lecture_late_threshold_minutes: number;
          max_selfie_kb: number;
          default_lecture_rate_egp: number;
          period_slots: Json;
          updated_at: string;
        };
        Insert: {
          id?: string;
          camp_id: string;
          default_lecture_duration_hours?: number;
          max_instructor_groups_per_day?: number;
          geofence_radius_meters?: number;
          first_lecture_late_threshold_minutes?: number;
          max_selfie_kb?: number;
          default_lecture_rate_egp?: number;
          period_slots?: Json;
          updated_at?: string;
        };
        Update: {
          default_lecture_duration_hours?: number;
          max_instructor_groups_per_day?: number;
          geofence_radius_meters?: number;
          first_lecture_late_threshold_minutes?: number;
          max_selfie_kb?: number;
          default_lecture_rate_egp?: number;
          period_slots?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'camp_settings_camp_id_fkey';
            columns: ['camp_id'];
            referencedRelation: 'camps';
            referencedColumns: ['id'];
          }
        ];
      };
      rooms: {
        Row: {
          id: string;
          venue_id: string;
          code: string;
          name: string;
          capacity: number;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          venue_id: string;
          code: string;
          name: string;
          capacity?: number;
          is_active?: boolean;
        };
        Update: {
          code?: string;
          name?: string;
          capacity?: number;
          is_active?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'rooms_venue_id_fkey';
            columns: ['venue_id'];
            referencedRelation: 'venues';
            referencedColumns: ['id'];
          }
        ];
      };
      camp_instructors: {
        Row: {
          id: string;
          camp_id: string;
          instructor_id: string;
          assigned_at: string;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          camp_id: string;
          instructor_id: string;
          assigned_at?: string;
          is_active?: boolean;
        };
        Update: {
          is_active?: boolean;
        };
        Relationships: [];
      };
      instructor_rates: {
        Row: {
          id: string;
          camp_id: string;
          instructor_id: string;
          lecture_rate_egp: number;
          effective_from_day: number;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          camp_id: string;
          instructor_id: string;
          lecture_rate_egp: number;
          effective_from_day?: number;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          lecture_rate_egp?: number;
          effective_from_day?: number;
        };
        Relationships: [];
      };
      groups: {
        Row: {
          id: string;
          camp_id: string;
          code: string;
          name_en: string;
          name_ar: string;
          track: string;
          default_room_id: string | null;
          capacity: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          camp_id: string;
          code: string;
          name_en: string;
          name_ar: string;
          track: string;
          default_room_id?: string | null;
          capacity?: number;
          created_at?: string;
        };
        Update: {
          code?: string;
          name_en?: string;
          name_ar?: string;
          track?: string;
          default_room_id?: string | null;
          capacity?: number;
        };
        Relationships: [];
      };
      group_instructors: {
        Row: {
          id: string;
          camp_id: string;
          group_id: string;
          instructor_id: string;
          effective_from_day: number;
          effective_to_day: number | null;
          assigned_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          camp_id: string;
          group_id: string;
          instructor_id: string;
          effective_from_day?: number;
          effective_to_day?: number | null;
          assigned_by?: string | null;
          created_at?: string;
        };
        Update: {
          effective_to_day?: number | null;
        };
        Relationships: [];
      };
      students: {
        Row: {
          id: string;
          camp_id: string;
          group_id: string;
          student_code: string;
          full_name: string;
          university: string | null;
          phone: string | null;
          is_active: boolean;
          joined_camp_day: number;
          enrolled_at: string;
          enrolled_by_profile_id: string | null;
          enrollment_origin: string;
          enrollment_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          camp_id: string;
          group_id: string;
          student_code: string;
          full_name: string;
          university?: string | null;
          phone?: string | null;
          is_active?: boolean;
          joined_camp_day?: number;
          enrolled_at?: string;
          enrolled_by_profile_id?: string | null;
          enrollment_origin?: string;
          enrollment_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          group_id?: string;
          student_code?: string;
          full_name?: string;
          university?: string | null;
          phone?: string | null;
          is_active?: boolean;
          joined_camp_day?: number;
          enrolled_at?: string;
          enrolled_by_profile_id?: string | null;
          enrollment_origin?: string;
          enrollment_reason?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      student_transfers: {
        Row: {
          id: string;
          camp_id: string;
          student_id: string;
          from_group_id: string;
          to_group_id: string;
          effective_camp_day: number;
          reason: string;
          transferred_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          camp_id: string;
          student_id: string;
          from_group_id: string;
          to_group_id: string;
          effective_camp_day: number;
          reason: string;
          transferred_by?: string | null;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      lectures: {
        Row: {
          id: string;
          camp_id: string;
          camp_day: number;
          lecture_date: string;
          period_number: number;
          start_time: string;
          end_time: string;
          duration_hours: number;
          group_id: string;
          instructor_id: string;
          substitute_instructor_id: string | null;
          room_id: string;
          topic: string;
          status: DbLectureStatus;
          frozen_rate_egp: number;
          instructor_acknowledged_at: string | null;
          revision_number: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          camp_id: string;
          camp_day: number;
          lecture_date: string;
          period_number: number;
          start_time: string;
          end_time: string;
          duration_hours?: number;
          group_id: string;
          instructor_id: string;
          substitute_instructor_id?: string | null;
          room_id: string;
          topic: string;
          status?: DbLectureStatus;
          frozen_rate_egp: number;
          instructor_acknowledged_at?: string | null;
          revision_number?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          camp_day?: number;
          lecture_date?: string;
          period_number?: number;
          start_time?: string;
          end_time?: string;
          duration_hours?: number;
          group_id?: string;
          instructor_id?: string;
          substitute_instructor_id?: string | null;
          room_id?: string;
          topic?: string;
          status?: DbLectureStatus;
          frozen_rate_egp?: number;
          instructor_acknowledged_at?: string | null;
          revision_number?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      daily_checkins: {
        Row: {
          id: string;
          camp_id: string;
          instructor_id: string;
          camp_day: number;
          checkin_date: string;
          server_timestamp: string;
          latitude: number;
          longitude: number;
          gps_accuracy_meters: number;
          distance_from_venue_meters: number;
          within_geofence: boolean;
          selfie_storage_path: string | null;
          selfie_size_kb: number | null;
          selfie_deleted_after_archive: boolean;
          arrived_late_first_lecture: boolean;
          minutes_after_first_lecture: number;
          status: DbCheckinStatus;
        };
        Insert: {
          id?: string;
          camp_id: string;
          instructor_id: string;
          camp_day: number;
          checkin_date: string;
          server_timestamp?: string;
          latitude: number;
          longitude: number;
          gps_accuracy_meters: number;
          distance_from_venue_meters: number;
          within_geofence: boolean;
          selfie_storage_path?: string | null;
          selfie_size_kb?: number | null;
          selfie_deleted_after_archive?: boolean;
          arrived_late_first_lecture?: boolean;
          minutes_after_first_lecture?: number;
          status?: DbCheckinStatus;
        };
        Update: {
          selfie_storage_path?: string | null;
          selfie_deleted_after_archive?: boolean;
          status?: DbCheckinStatus;
        };
        Relationships: [];
      };
      checkin_exceptions: {
        Row: {
          id: string;
          checkin_id: string | null;
          camp_id: string;
          instructor_id: string;
          camp_day: number;
          reason: string;
          status: DbRequestStatus;
          reviewed_by: string | null;
          review_note: string | null;
          reviewed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          checkin_id?: string | null;
          camp_id: string;
          instructor_id: string;
          camp_day: number;
          reason: string;
          status?: DbRequestStatus;
          reviewed_by?: string | null;
          review_note?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Update: {
          status?: DbRequestStatus;
          reviewed_by?: string | null;
          review_note?: string | null;
          reviewed_at?: string | null;
        };
        Relationships: [];
      };
      attendance_sheets: {
        Row: {
          id: string;
          camp_id: string;
          lecture_id: string;
          instructor_id: string;
          status: DbAttendanceSheetStatus;
          sync_state: DbOfflineSyncState;
          idempotency_key: string;
          present_count: number;
          absent_count: number;
          cross_group_count: number;
          submitted_at: string | null;
          synced_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          camp_id: string;
          lecture_id: string;
          instructor_id: string;
          status?: DbAttendanceSheetStatus;
          sync_state?: DbOfflineSyncState;
          idempotency_key: string;
          present_count?: number;
          absent_count?: number;
          cross_group_count?: number;
          submitted_at?: string | null;
          synced_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: DbAttendanceSheetStatus;
          sync_state?: DbOfflineSyncState;
          present_count?: number;
          absent_count?: number;
          cross_group_count?: number;
          submitted_at?: string | null;
          synced_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      attendance_records: {
        Row: {
          id: string;
          camp_id: string;
          attendance_sheet_id: string;
          lecture_id: string;
          camp_day: number;
          period_number: number;
          student_id: string;
          origin_group_id: string;
          attended_group_id: string;
          is_cross_group: boolean;
          mark: DbAttendanceMark;
          note: string | null;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          camp_id: string;
          attendance_sheet_id: string;
          lecture_id: string;
          camp_day: number;
          period_number: number;
          student_id: string;
          origin_group_id: string;
          attended_group_id: string;
          is_cross_group?: boolean;
          mark?: DbAttendanceMark;
          note?: string | null;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: {
          attended_group_id?: string;
          is_cross_group?: boolean;
          mark?: DbAttendanceMark;
          note?: string | null;
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      lecture_entitlements: {
        Row: {
          id: string;
          camp_id: string;
          lecture_id: string;
          instructor_id: string;
          camp_day: number;
          period_number: number;
          frozen_rate_egp: number;
          entitlement_amount_egp: number;
          status: DbEntitlementStatus;
          eligibility_reason: string;
          anomaly_flag: string | null;
          admin_override_by: string | null;
          admin_override_reason: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          camp_id: string;
          lecture_id: string;
          instructor_id: string;
          camp_day: number;
          period_number: number;
          frozen_rate_egp: number;
          entitlement_amount_egp: number;
          status?: DbEntitlementStatus;
          eligibility_reason: string;
          anomaly_flag?: string | null;
          admin_override_by?: string | null;
          admin_override_reason?: string | null;
          updated_at?: string;
        };
        Update: {
          entitlement_amount_egp?: number;
          status?: DbEntitlementStatus;
          eligibility_reason?: string;
          anomaly_flag?: string | null;
          admin_override_by?: string | null;
          admin_override_reason?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      instructor_requests: {
        Row: {
          id: string;
          camp_id: string;
          instructor_id: string;
          request_type: string;
          subject: string;
          details: string;
          status: DbRequestStatus;
          reviewed_by: string | null;
          review_note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          camp_id: string;
          instructor_id: string;
          request_type: string;
          subject: string;
          details: string;
          status?: DbRequestStatus;
          reviewed_by?: string | null;
          review_note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: DbRequestStatus;
          reviewed_by?: string | null;
          review_note?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          recipient_profile_id: string;
          title_en: string;
          title_ar: string;
          body_en: string;
          body_ar: string;
          is_read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          recipient_profile_id: string;
          title_en: string;
          title_ar: string;
          body_en: string;
          body_ar: string;
          is_read?: boolean;
          created_at?: string;
        };
        Update: {
          is_read?: boolean;
        };
        Relationships: [];
      };
      issues: {
        Row: {
          id: string;
          camp_id: string;
          reported_by: string;
          room_id: string | null;
          category: string;
          title: string;
          description: string;
          severity: DbIssueSeverity;
          status: DbIssueStatus;
          resolved_by: string | null;
          resolution_note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          camp_id: string;
          reported_by: string;
          room_id?: string | null;
          category: string;
          title: string;
          description: string;
          severity?: DbIssueSeverity;
          status?: DbIssueStatus;
          resolved_by?: string | null;
          resolution_note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          severity?: DbIssueSeverity;
          status?: DbIssueStatus;
          resolved_by?: string | null;
          resolution_note?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      daily_checklists: {
        Row: {
          id: string;
          camp_id: string;
          camp_day: number;
          task_title_en: string;
          task_title_ar: string;
          is_completed: boolean;
          completed_by: string | null;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          camp_id: string;
          camp_day: number;
          task_title_en: string;
          task_title_ar: string;
          is_completed?: boolean;
          completed_by?: string | null;
          completed_at?: string | null;
        };
        Update: {
          is_completed?: boolean;
          completed_by?: string | null;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      survey_links: {
        Row: {
          id: string;
          camp_id: string;
          instructor_id: string | null;
          title: string;
          url: string;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          camp_id: string;
          instructor_id?: string | null;
          title: string;
          url: string;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          title?: string;
          url?: string;
          is_active?: boolean;
        };
        Relationships: [];
      };
      survey_results: {
        Row: {
          id: string;
          survey_link_id: string;
          camp_id: string;
          instructor_id: string | null;
          responses_count: number;
          average_score: number;
          summary_note: string | null;
          recorded_at: string;
        };
        Insert: {
          id?: string;
          survey_link_id: string;
          camp_id: string;
          instructor_id?: string | null;
          responses_count?: number;
          average_score?: number;
          summary_note?: string | null;
          recorded_at?: string;
        };
        Update: {
          responses_count?: number;
          average_score?: number;
          summary_note?: string | null;
        };
        Relationships: [];
      };
      instructor_evaluations: {
        Row: {
          id: string;
          camp_id: string;
          instructor_id: string;
          evaluated_by: string;
          punctuality_score: number;
          delivery_score: number;
          compliance_score: number;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          camp_id: string;
          instructor_id: string;
          evaluated_by: string;
          punctuality_score: number;
          delivery_score: number;
          compliance_score: number;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          punctuality_score?: number;
          delivery_score?: number;
          compliance_score?: number;
          notes?: string | null;
        };
        Relationships: [];
      };
      attachments: {
        Row: {
          id: string;
          camp_id: string | null;
          uploaded_by: string;
          entity_type: string;
          entity_id: string;
          storage_path: string;
          file_size_kb: number;
          mime_type: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          camp_id?: string | null;
          uploaded_by: string;
          entity_type: string;
          entity_id: string;
          storage_path: string;
          file_size_kb: number;
          mime_type: string;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          actor_profile_id: string | null;
          actor_name: string;
          actor_role: DbUserRole;
          camp_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string;
          previous_value: Json | null;
          new_value: Json | null;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_profile_id?: string | null;
          actor_name: string;
          actor_role: DbUserRole;
          camp_id?: string | null;
          action: string;
          entity_type: string;
          entity_id: string;
          previous_value?: Json | null;
          new_value?: Json | null;
          reason?: string | null;
          created_at?: string;
        };
        Update: never; // Append-only immutable table
        Relationships: [];
      };
      backup_records: {
        Row: {
          id: string;
          camp_id: string | null;
          created_by: string;
          backup_type: DbBackupType;
          size_kb: number;
          checksum_sha256: string;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          camp_id?: string | null;
          created_by: string;
          backup_type: DbBackupType;
          size_kb: number;
          checksum_sha256: string;
          notes?: string | null;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      is_cits_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      is_active_cits_user: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      current_instructor_id: {
        Args: Record<string, never>;
        Returns: string | null;
      };
      resolve_login_identifier: {
        Args: { p_identifier: string };
        Returns: string | null;
      };
      is_instructor_assigned_to_camp: {
        Args: { p_camp_id: string };
        Returns: boolean;
      };
      is_instructor_assigned_to_group: {
        Args: { p_group_id: string };
        Returns: boolean;
      };
      submit_attendance_sheet_tx: {
        Args: { p_sheet_id: string };
        Returns: {
          sheet_id: string;
          present_count: number;
          absent_count: number;
          cross_group_count?: number;
          entitlement_status: DbEntitlementStatus;
          entitlement_amount_egp: number;
        };
      };
      admin_correct_attendance_tx: {
        Args: {
          p_sheet_id: string;
          p_student_id: string;
          p_mark: DbAttendanceMark;
          p_note: string;
        };
        Returns: {
          sheet_id: string;
          student_id: string;
          mark: DbAttendanceMark;
          present_count: number;
          absent_count: number;
          cross_group_count: number;
        };
      };
      admin_override_entitlement_tx: {
        Args: {
          p_entitlement_id: string;
          p_decision: DbEntitlementStatus;
          p_reason: string;
        };
        Returns: {
          entitlement_id: string;
          status: DbEntitlementStatus;
          entitlement_amount_egp: number;
        };
      };
      submit_daily_checkin_tx: {
        Args: {
          p_camp_id: string;
          p_latitude: number;
          p_longitude: number;
          p_gps_accuracy_meters: number;
          p_selfie_storage_path: string;
          p_selfie_size_kb: number;
          p_exception_reason?: string | null;
        };
        Returns: {
          checkin_id: string;
          camp_day: number;
          distance_from_venue_meters: number;
          within_geofence: boolean;
          arrived_late_first_lecture: boolean;
          minutes_after_first_lecture: number;
          status: DbCheckinStatus;
        };
      };
      acknowledge_lecture_tx: {
        Args: { p_lecture_id: string };
        Returns: { lecture_id: string; instructor_acknowledged_at: string };
      };
      transfer_student_tx: {
        Args: {
          p_camp_id: string;
          p_student_id: string;
          p_to_group_id: string;
          p_effective_camp_day: number;
          p_reason: string;
        };
        Returns: {
          transfer_id: string;
          student_id: string;
          from_group_id: string;
          to_group_id: string;
          effective_camp_day: number;
        };
      };
      batch_import_students_tx: {
        Args: {
          p_camp_id: string;
          p_group_id: string;
          p_mode: string;
          p_rows: Json;
        };
        Returns: { inserted: number; updated: number };
      };
      review_checkin_exception_tx: {
        Args: {
          p_exception_id: string;
          p_decision: DbRequestStatus;
          p_review_note: string;
        };
        Returns: {
          exception_id: string;
          status: DbRequestStatus;
          checkin_status: DbCheckinStatus;
        };
      };
      archive_camp_tx: {
        Args: { p_camp_id: string };
        Returns: { camp_id: string; status: DbCampStatus; purged_paths: string[] };
      };
      complete_password_change_tx: {
        Args: Record<string, never>;
        Returns: { ok: boolean; profile_id: string; must_change_password: boolean };
      };
      record_admin_totp_verified_tx: {
        Args: Record<string, never>;
        Returns: { ok: boolean; profile_id: string; totp_verified_at: string };
      };
    };
    Enums: {
      user_role: DbUserRole;
      camp_status: DbCampStatus;
      lecture_status: DbLectureStatus;
      checkin_status: DbCheckinStatus;
      attendance_sheet_status: DbAttendanceSheetStatus;
      offline_sync_state: DbOfflineSyncState;
      attendance_mark: DbAttendanceMark;
      entitlement_status: DbEntitlementStatus;
      request_status: DbRequestStatus;
      issue_severity: DbIssueSeverity;
      issue_status: DbIssueStatus;
    };
  };
}

// =============================================================================
// PART B: FRONTEND OPERATIONAL DOMAIN TYPES
// =============================================================================

export enum UserRole {
  ADMIN = 'admin',
  INSTRUCTOR = 'instructor',
}

export enum CampStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  PENDING_ARCHIVE = 'pending_archive',
  ARCHIVED = 'archived',
}

export enum LectureStatus {
  SCHEDULED = 'scheduled',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum CheckinStatus {
  VERIFIED = 'verified',
  OUTSIDE_GEOFENCE = 'outside_geofence',
  LATE_FIRST_LECTURE = 'late_first_lecture',
  EXCEPTION_PENDING = 'exception_pending',
  EXCEPTION_APPROVED = 'exception_approved',
  EXCEPTION_REJECTED = 'exception_rejected',
}

export enum AttendanceSheetStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  LOCKED = 'locked',
}

export enum OfflineSyncState {
  OFFLINE = 'Offline',
  SYNCING = 'Syncing',
  SYNCED = 'Synced',
  FAILED = 'Failed',
}

export enum AttendanceMark {
  PRESENT = 'present',
  ABSENT = 'absent',
  LATE = 'late',
  EXCUSED = 'excused',
}

export enum EntitlementStatus {
  ELIGIBLE = 'eligible',
  PENDING_REVIEW = 'pending_review',
  APPROVED = 'approved',
  EXCLUDED = 'excluded',
}

export enum RequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum IssueSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum IssueStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
}

export interface Profile {
  id: string;
  role: UserRole;
  username: string;
  email: string;
  fullNameEn: string;
  fullNameAr: string;
  phone: string;
  mustChangePassword: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface AdminAccount {
  id: string;
  profileId: string;
  assignedSlot: 1 | 2;
  totpEnrolled: boolean;
  totpVerifiedAt: string | null;
}

export interface Instructor {
  id: string;
  profileId: string;
  instructorCode: string;
  fullNameEn: string;
  fullNameAr: string;
  username: string;
  email: string;
  phone: string;
  specialization: string;
  defaultLectureRateEgp: number;
  bio?: string;
  isActive: boolean;
}

export interface Venue {
  id: string;
  nameEn: string;
  nameAr: string;
  address: string;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
}

export interface Room {
  id: string;
  venueId: string;
  code: string;
  name: string;
  capacity: number;
}

export interface PeriodSlot {
  period: number;
  start: string;
  end: string;
}

export interface CampSettings {
  campId: string;
  defaultLectureDurationHours: number;
  maxInstructorGroupsPerDay: number;
  geofenceRadiusMeters: number;
  firstLectureLateThresholdMinutes: number;
  maxSelfieKb: number;
  defaultLectureRateEgp: number;
  periodSlots: PeriodSlot[];
}

export interface Camp {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  status: CampStatus;
  venueId: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  currentCampDay: number;
  settings: CampSettings;
}

export interface Group {
  id: string;
  campId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  track: string;
  defaultRoomId: string;
  primaryInstructorId: string;
  capacity: number;
}

export interface Student {
  id: string;
  campId: string;
  groupId: string;
  studentCode: string;
  fullName: string;
  university: string;
  isActive: boolean;
  /** Day 1 for initial roster; 2+ for approved mid-camp enrollment. */
  joinedCampDay?: number;
  enrolledAt?: string;
  enrolledByProfileId?: string | null;
  enrollmentOrigin?: string;
  enrollmentReason?: string | null;
}

export interface Lecture {
  id: string;
  campId: string;
  campDay: number;
  lectureDate: string;
  periodNumber: number;
  startTime: string;
  endTime: string;
  durationHours: number;
  groupId: string;
  instructorId: string;
  substituteInstructorId: string | null;
  roomId: string;
  topic: string;
  status: LectureStatus;
  frozenRateEgp: number;
  instructorAcknowledgedAt: string | null;
  revisionNumber: number;
}

export interface DailyCheckin {
  id: string;
  campId: string;
  instructorId: string;
  campDay: number;
  checkinDate: string;
  serverTimestamp: string;
  latitude: number;
  longitude: number;
  gpsAccuracyMeters: number;
  distanceFromVenueMeters: number;
  withinGeofence: boolean;
  selfieStoragePath?: string | null;
  selfieSizeKb: number;
  selfieDeletedAfterArchive?: boolean;
  arrivedLateFirstLecture: boolean;
  minutesAfterFirstLecture: number;
  status: CheckinStatus;
  exceptionReason?: string;
}

export interface AttendanceRecordItem {
  studentId: string;
  studentCode: string;
  studentName: string;
  originGroupId: string;
  attendedGroupId: string;
  isCrossGroup: boolean;
  mark: AttendanceMark | 'unmarked';
  note?: string;
}

export interface AttendanceSheet {
  id: string;
  campId: string;
  lectureId: string;
  instructorId: string;
  campDay: number;
  periodNumber: number;
  status: AttendanceSheetStatus;
  syncState: OfflineSyncState;
  idempotencyKey: string;
  records: AttendanceRecordItem[];
  submittedAt: string | null;
  syncedAt: string | null;
}

export interface LectureEntitlement {
  id: string;
  campId: string;
  lectureId: string;
  instructorId: string;
  campDay: number;
  periodNumber: number;
  frozenRateEgp: number;
  entitlementAmountEgp: number;
  status: EntitlementStatus;
  eligibilityReason: string;
  anomalyFlag?: string;
  adminOverrideReason?: string;
  updatedAt: string;
}

export interface InstructorRequestItem {
  id: string;
  campId: string;
  instructorId: string;
  requestType: 'checkin_exception' | 'schedule_change' | 'substitute_request' | 'room_support';
  subject: string;
  details: string;
  status: RequestStatus;
  reviewNote?: string;
  createdAt: string;
}

export interface OperationalIssue {
  id: string;
  campId: string;
  roomId: string;
  category: string;
  title: string;
  description: string;
  severity: IssueSeverity;
  status: IssueStatus;
  reportedBy: string;
  createdAt: string;
}

export interface DailyChecklistItem {
  id: string;
  campId: string;
  campDay: number;
  titleEn: string;
  titleAr: string;
  isCompleted: boolean;
}

export interface SurveyLinkItem {
  id: string;
  campId: string;
  instructorId: string | null;
  title: string;
  url: string;
  responsesCount: number;
  averageScore: number;
}

export interface StudentTransfer {
  id: string;
  campId: string;
  studentId: string;
  fromGroupId: string;
  toGroupId: string;
  effectiveCampDay: number;
  reason: string;
  transferredBy: string | null;
  createdAt: string;
}

export interface CheckinExceptionItem {
  id: string;
  checkinId: string | null;
  campId: string;
  instructorId: string;
  campDay: number;
  reason: string;
  status: RequestStatus;
  reviewedBy: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  recipientProfileId: string;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
  isRead: boolean;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorProfileId?: string | null;
  actorName: string;
  actorRole: UserRole;
  campId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  previousValue: string;
  newValue: string;
  reason: string;
  createdAt: string;
}

export type AdminRouteId =
  | 'dashboard'
  | 'camps'
  | 'instructors'
  | 'students'
  | 'schedule'
  | 'attendance'
  | 'finance'
  | 'reports'
  | 'operations'
  | 'settings';

export type InstructorRouteId =
  | 'dashboard'
  | 'schedule'
  | 'checkin'
  | 'attendance'
  | 'profile';
